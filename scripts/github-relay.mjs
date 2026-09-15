import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { validateSnapshot } from './facts.mjs';

const base = process.env.CONTENT_UPDATER_URL;
const secret = process.env.CONTENT_AUTOMATION_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || 'gontii/gta-companion-content';
if (!base || !secret || !process.env.GH_TOKEN) throw new Error('Brak konfiguracji przekaźnika');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gh = async (path, method = 'GET', body) => {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method, headers: { authorization: `Bearer ${process.env.GH_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
};
const worker = async (path, body) => {
  const response = await fetch(new URL(path, base), {
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Automat HTTP ${response.status}`);
  return response.json();
};

async function syncIssues(incidents) {
  const marker = '<!-- gta-content-automation:';
  const issues = await gh('issues?state=open&per_page=100');
  const ours = issues.filter(i => !i.pull_request && i.body?.startsWith(marker));
  for (const incident of incidents) {
    const tag = `${marker}${incident.key} -->`;
    const body = `${tag}\nAutomatyczna kontrola GTA Companion.\n\nPowód: ${incident.reason}\n\nPoczątek: ${incident.since || 'brak danych'}\n\nNastępne sprawdzenie wykona Cloudflare. Zgłoszenie zamknie się po potwierdzeniu usunięcia problemu.`;
    const found = ours.find(i => i.body.startsWith(tag));
    if (!found) await gh('issues', 'POST', { title: `[Aktualizacje] ${incident.reason}`.slice(0, 180), body });
    else if (found.body !== body) await gh(`issues/${found.number}`, 'PATCH', { body });
  }
  for (const issue of ours) if (!incidents.some(i => issue.body.startsWith(`${marker}${i.key} -->`))) await gh(`issues/${issue.number}`, 'PATCH', { state: 'closed', state_reason: 'completed' });
}

let status;
try { status = await worker('/status'); }
catch (error) {
  await syncIssues([{ key: 'cloudflare-unreachable', reason: 'Cloudflare nie odpowiada na niezależną kontrolę', since: null }]);
  throw error;
}
if (status.needsSmokeToken && process.env.BETA_SMOKE_CODE && process.env.SMOKE_TEST_EMAIL) {
  const response = await fetch('https://gtacompanion.net/api/access/redeem', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(25000),
    body: JSON.stringify({ code: process.env.BETA_SMOKE_CODE, email: process.env.SMOKE_TEST_EMAIL }),
  });
  const result = await response.json();
  if (!response.ok || !result.token) throw new Error('Nie udało się odświeżyć dostępu do smoke testu');
  await worker('/smoke-token', { token: result.token });
}
if (process.env.REQUEST_CONTENT_CHECK === 'true') await worker('/check', {});
if (process.env.PROBE_TGG === 'true') await worker('/probe-tgg', {});
const { entries } = await worker('/outbox');
const paths = new Set();
let latest;
try { latest = JSON.parse(await readFile('weekly/latest.json', 'utf8')); } catch { /* first publication */ }
for (const entry of entries.sort((a, b) => a.snapshot.generatedAt.localeCompare(b.snapshot.generatedAt))) {
  const snapshot = entry.snapshot;
  validateSnapshot(snapshot, { published: true });
  if (!/^[a-f0-9]{64}$/.test(snapshot.revision) || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.weekId)) throw new Error('Nieprawidłowy identyfikator publikacji');
  await mkdir('weekly/revisions', { recursive: true });
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  const file = `weekly/revisions/${snapshot.revision}.json`;
  await writeFile(file, serialized); paths.add(file);
  const weekFile = `weekly/${snapshot.weekId}.json`;
  let week;
  try { week = JSON.parse(await readFile(weekFile, 'utf8')); } catch { /* new week */ }
  if (!week?.generatedAt || week.generatedAt <= snapshot.generatedAt) { await writeFile(weekFile, serialized); paths.add(weekFile); }
  if (!latest?.generatedAt || latest.generatedAt <= snapshot.generatedAt) { latest = snapshot; await writeFile('weekly/latest.json', serialized); paths.add('weekly/latest.json'); }
}
if (paths.size) {
  git('add', '--', ...paths);
  if (git('diff', '--cached', '--name-only')) {
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    git('diff', '--cached', '--check');
    git('commit', '-m', 'Zapisz historię automatycznej aktualizacji GTA Companion');
    // Concurrent edits fail the push; no force/rebase of generated history. Next job retries from main.
    git('push', 'origin', 'HEAD:main');
  }
  await worker('/ack', { ids: entries.map(e => e.id) });
}
const incidents = status.incidents || [];
if (!status.heartbeatAt || Date.now() - Date.parse(status.heartbeatAt) > 45 * 60000) incidents.push({ key: 'cloudflare-silent', reason: 'Brak sygnału harmonogramu Cloudflare przez ponad 45 minut', since: status.heartbeatAt });
if (status.mode === 'publish') await syncIssues(incidents);
console.log(JSON.stringify({ mode: status.mode, revision: status.publishedRevision, verifiedRevision: status.verifiedRevision, nextRunAt: status.nextRunAt,
  sources: status.sources, sourceFailures: status.sourceFailures,
  tggProbe: status.tggProbe ? { checkedAt: status.tggProbe.checkedAt, source: status.tggProbe.source, facts: status.tggProbe.facts?.length, error: status.tggProbe.error, retryAt: status.tggProbe.retryAt } : null,
  transcriptCheck: status.transcriptCheck ? Object.fromEntries(Object.entries(status.transcriptCheck).filter(([key]) => key !== 'sample')) : null,
  copied: entries.length, incidents: incidents.length }));
