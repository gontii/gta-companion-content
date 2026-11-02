import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { explainUpdaterHttpError, matchesUpdaterRoute, updaterUrl } from '../scripts/updater-routes.mjs';

const token = 'token-should-not-leak';
const smokeCode = 'code-should-not-leak';

function listen() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push(`${req.method} ${url.pathname}`);
    const authed = req.headers.authorization === `Bearer ${token}`;
    if (url.pathname === '/api/access/redeem') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'access_required' }));
      return;
    }
    if (!authed) {
      res.writeHead(404, { 'content-type': 'text/plain;charset=UTF-8' });
      res.end('Not found');
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && matchesUpdaterRoute(url.pathname, '/status')) {
      res.end(JSON.stringify({
        mode: 'publish', verificationMode: 'render-digest-v1', needsSmokeToken: Boolean(server.needsSmokeToken),
        heartbeatAt: new Date().toISOString(), incidents: [],
      }));
      return;
    }
    if (req.method === 'GET' && matchesUpdaterRoute(url.pathname, '/outbox')) {
      res.end(JSON.stringify({ entries: server.entries || [] }));
      return;
    }
    if (req.method === 'POST' && matchesUpdaterRoute(url.pathname, '/smoke-token')) {
      res.end(JSON.stringify({ accepted: true }));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain;charset=UTF-8' });
    res.end('Not found');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, calls, port: server.address().port })));
}

function runRelay(port, extra = {}, cwd) {
  const { GH_TOKEN, GITHUB_TOKEN, GITHUB_ACTIONS, BETA_SMOKE_CODE, SMOKE_TEST_EMAIL, SMOKE_REDEEM_URL, RELAY_DRY_RUN, CONTENT_UPDATER_URL, CONTENT_AUTOMATION_TOKEN, ...env } = process.env;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/github-relay.mjs', import.meta.url))], {
    cwd: cwd || process.cwd(),
    env: {
      ...env,
      CONTENT_INCIDENTS_MODE: 'external',
      CONTENT_UPDATER_URL: `http://127.0.0.1:${port}`,
      CONTENT_AUTOMATION_TOKEN: token,
      ...extra,
    },
  });
  let output = '', error = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { error += chunk; });
  return new Promise(resolve => child.on('close', code => resolve({ code, output, error })));
}

test('trasy automatu zachowują prefiks i odrzucają podobne końcówki', () => {
  assert.equal(matchesUpdaterRoute('/status', '/status'), true);
  assert.equal(matchesUpdaterRoute('/updater/status', '/status'), true);
  assert.equal(matchesUpdaterRoute('/recheck', '/check'), false);
  assert.equal(matchesUpdaterRoute('/status-extra', '/status'), false);
  assert.equal(updaterUrl('https://example.test/updater', '/status').pathname, '/updater/status');
  assert.equal(updaterUrl('https://example.test', '/outbox').pathname, '/outbox');
  const explained = explainUpdaterHttpError('GET', '/status', 404, 'Not found');
  assert.match(explained, /GET \/status/);
  assert.match(explained, /CONTENT_AUTOMATION_TOKEN/);
  assert.match(explained, /AUTOMATION_TOKEN/);
  assert.equal(explained.includes(token), false);
  assert.match(explainUpdaterHttpError('GET', '/status', 404, 'error code: 1042'), /1042/);
  assert.equal(explainUpdaterHttpError('GET', '/status', 500, 'Bearer sekret-ktorego-nie-wolno-powtorzyc').includes('sekret-ktorego-nie-wolno-powtorzyc'), false);
});

test('Worker i przekaźnik używają wspólnego dopasowania tras', async () => {
  const worker = await readFile(new URL('../worker/index.mjs', import.meta.url), 'utf8');
  const relay = await readFile(new URL('../scripts/github-relay.mjs', import.meta.url), 'utf8');
  assert.match(worker, /matchesUpdaterRoute/);
  assert.match(relay, /updaterUrl/);
  assert.match(relay, /RELAY_DRY_RUN/);
});

test('suchy przebieg odczytuje status i kolejkę pod prefiksem i niczego nie zapisuje', async () => {
  const { server, calls, port } = await listen();
  server.entries = [{
    id: 'ab'.repeat(32),
    snapshot: {
      schemaVersion: 2, weekId: '2026-10-29', revision: 'ab'.repeat(32), generatedAt: '2026-10-31T12:00:00.000Z',
      sections: [{ id: 'bonuses', items: [{ id: 'item-1', label: 'Test bonus', confidence: 'official', startsAt: '2026-10-29T09:00:00.000Z', expiresAt: '2026-11-05T09:00:00.000Z' }] }],
    },
  }];
  const cwd = await mkdtemp(join(tmpdir(), 'relay-dry-'));
  try {
    const result = await runRelay(port, { CONTENT_UPDATER_URL: `http://127.0.0.1:${port}/updater`, RELAY_DRY_RUN: 'true' }, cwd);
    assert.equal(result.code, 0, result.error + result.output);
    assert.deepEqual(calls, ['GET /updater/status', 'GET /updater/outbox']);
    const report = JSON.parse(result.output);
    assert.equal(report.dryRun, true);
    assert.equal(report.copied, 1);
    assert.equal(report.written, 0);
    assert.deepEqual(report.routes, ['GET /status', 'GET /outbox']);
    assert.equal(result.output.includes(token), false);
    assert.deepEqual(await readdir(cwd), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('HTTP 404 z treścią Not found wskazuje token i trasę, bez wartości sekretu', async () => {
  const { server, calls, port } = await listen();
  try {
    const result = await runRelay(port, { CONTENT_AUTOMATION_TOKEN: 'inny-niz-oczekiwany' });
    assert.equal(result.code, 1);
    assert.match(result.error, /Automat HTTP 404 na GET \/status/);
    assert.match(result.error, /CONTENT_AUTOMATION_TOKEN/);
    assert.match(result.error, /AUTOMATION_TOKEN/);
    assert.equal(result.error.includes('inny-niz-oczekiwany'), false);
    assert.equal(result.error.includes(token), false);
    assert.deepEqual(calls, ['GET /status']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('odrzucenie kodu odbioru nie przerywa odczytu kolejki', async () => {
  const { server, calls, port } = await listen();
  server.needsSmokeToken = true;
  try {
    const result = await runRelay(port, {
      BETA_SMOKE_CODE: smokeCode,
      SMOKE_TEST_EMAIL: 'person@example.com',
      SMOKE_REDEEM_URL: `http://127.0.0.1:${port}/api/access/redeem`,
    });
    assert.equal(result.code, 0, result.error + result.output);
    assert.deepEqual(calls, ['GET /status', 'POST /api/access/redeem', 'GET /outbox']);
    assert.match(result.error, /Ostrzeżenie: Odnowienie odbioru: HTTP 401, access_required/);
    assert.match(result.output, /access_required/);
    assert.equal(result.output.includes(smokeCode), false);
    assert.equal(result.error.includes(smokeCode), false);
    assert.equal(result.output.includes('person@example.com'), false);
    const report = JSON.parse(result.output);
    assert.equal(report.smokeRefresh.ok, false);
    assert.equal(report.copied, 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
