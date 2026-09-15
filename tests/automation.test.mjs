import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atLocal, nextCheck, localParts, windowFromDays, collectEvents, projectContent } from '../scripts/temporal.mjs';
import { agreeSources, mergeFacts, validateFacts, upgradeLegacy, validateSnapshot } from '../scripts/facts.mjs';
import { selectTggVideo, TGG_CHANNEL, SourceService } from '../scripts/source-service.mjs';
import { PublicationEngine } from '../worker/coordinator.mjs';

const legacy = JSON.parse(await readFile(new URL('../weekly/2026-09-10.json', import.meta.url)));
const fact = {
  section: 'bonuses', entity: 'Contact Missions', offer: '2X GTA$ & RP', eligibility: 'all', platform: 'all',
  startsOn: '2026-09-17', endsOn: '2026-09-23', evidence: 'Contact Missions pay 2X GTA$ & RP', dateEvidence: 'September 17–23',
  sources: [{ kind: 'rockstar', url: 'https://www.rockstargames.com/newswire/article/example' }], confidence: 'official',
};
test('Warsaw schedule handles summer/winter, Tue/Wed/Thu, Sunday expiry and no UTC drift', () => {
  assert.equal(new Date(atLocal('2026-09-17', 650)).toISOString(), '2026-09-17T08:50:00.000Z');
  assert.equal(new Date(atLocal('2026-12-17', 650)).toISOString(), '2026-12-17T09:50:00.000Z');
  for (const date of ['2026-09-15', '2026-09-16', '2026-09-17']) {
    const first = nextCheck(atLocal(date, 529));
    assert.equal(localParts(first.at).minutes, 530);
    assert.equal(nextCheck(first.at).at - first.at, 15 * 60000);
    assert.equal(localParts(nextCheck(atLocal(date, 724), [], true).at).minutes, 725);
    assert.equal(localParts(nextCheck(atLocal(date, 725), [], true).at).minutes, 785);
  }
  const weekend = windowFromDays('2026-10-23', '2026-10-25');
  assert.equal(weekend.expiresAt, '2026-10-25T23:00:00.000Z');
  assert.equal(localParts(nextCheck(atLocal('2026-09-18', 650)).at).minutes, 890);
  assert.equal(localParts(nextCheck(atLocal('2026-09-17', 1325), [], true).at).minutes, 530);
});
test('known reset gets preparation ten minutes before and activation on the boundary', () => {
  const at = atLocal('2026-09-17', 600);
  const events = [{ key: 'reset', kind: 'start', at, reason: 'Reset', confidence: 'confirmed' }];
  assert.equal(nextCheck(at - 11 * 60000, events).at, at - 10 * 60000);
  assert.equal(nextCheck(at - 60000, events).at, at);
});
test('weekend expiry removes every dependent view offline without changing progress ids', () => {
  const c = upgradeLegacy(legacy);
  const item = c.sections[0].items[0];
  item.expiresAt = '2026-09-13T22:00:00.000Z';
  c.quickTakeEntries = [{ id: 'quick', label: item.label, itemIds: [item.id] }];
  c.beginnerPath = [{ id: 'bp-1', label: item.label, itemIds: [item.id] }];
  c.locations = [{ id: 'place', activity: 'a', name: 'n', area: 'a', itemIds: [item.id] }];
  assert.equal(projectContent(c, Date.parse('2026-09-13T21:59:59Z')).sections[0].items[0].id, item.id);
  const after = projectContent(c, Date.parse(item.expiresAt));
  assert.ok(!after.sections[0].items.some(i => i.id === item.id));
  assert.deepEqual([after.quickTake, after.beginnerPath, after.locations], [[], [], []]);
  assert.ok(projectContent(legacy, Date.parse('2026-09-18')).sections.every(s => !s.items.length));
});
test('events retain future deadlines and include seasonal qualification and claiming', () => {
  const c = upgradeLegacy(legacy), now = Date.parse('2026-09-15');
  const previous = [{ key: 'unrelated', at: Date.parse('2026-10-01'), reason: 'Zapisany termin' }];
  const events = collectEvents(c, previous, now);
  assert.ok(events.some(e => e.key === 'unrelated'));
  assert.ok(events.some(e => e.key.includes('/claim:startsAt')));
  assert.ok(events.some(e => e.key.includes('/qualify:expiresAt')));
});
test('two fans must agree on amount, dates, platform and membership; official wins', () => {
  const docs = [
    { source: { kind: 'intel' }, current: true, facts: [fact] },
    { source: { kind: 'gtabase' }, current: true, facts: [{ ...fact, offer: '3X GTA$ & RP' }] },
    { source: { kind: 'tgg' }, facts: [fact] },
  ];
  assert.equal(agreeSources(docs, true).length, 0);
  docs[1].facts = [fact]; assert.equal(agreeSources(docs, true)[0].confidence, 'corroborated');
  docs.push({ source: { kind: 'rockstar' }, facts: [{ ...fact, offer: '4X GTA$ & RP' }] });
  assert.equal(agreeSources(docs, true)[0].offer, '4X GTA$ & RP');
  for (const field of ['platform', 'eligibility', 'endsOn']) {
    assert.equal(agreeSources([docs[0], { ...docs[1], facts: [{ ...fact, [field]: 'different' }] }], false).length, 0);
  }
  assert.equal(agreeSources([docs[2]], true)[0].confidence, 'transcript');
});
test('future preview activates later, verified smaller week and stable correction ids', async () => {
  let c = await mergeFacts(legacy, [fact], atLocal('2026-09-16', 650));
  assert.equal(c.weekId, legacy.weekId);
  c = await mergeFacts(c, [fact], atLocal('2026-09-17', 660));
  assert.equal(c.weekId, '2026-09-17');
  const id = c.sections[0].items[0].id;
  c = await mergeFacts(c, [{ ...fact, offer: '3X GTA$ & RP' }], atLocal('2026-09-17', 700));
  assert.equal(c.sections[0].items[0].id, id);
  assert.match(c.sections[0].items[0].label, /3X/);
  validateSnapshot(c);
});
test('fact validation rejects fabricated numbers, ungrounded dates and wrong timestamp', () => {
  const doc = { text: `${fact.evidence}. ${fact.dateEvidence}`, source: fact.sources[0], period: null };
  assert.equal(validateFacts({ facts: [fact] }, doc).facts.length, 1);
  assert.equal(validateFacts({ facts: [{ ...fact, offer: '99X GTA$' }] }, doc).facts.length, 0);
  assert.equal(validateFacts({ facts: [{ ...fact, endsOn: '2026-10-23' }] }, doc).facts.length, 0);
  assert.equal(validateFacts({ facts: [{ ...fact, offsetMs: 7000 }] }, { ...doc, source: { kind: 'tgg' }, chunks: [{ text: doc.text, offset: 0 }] }).facts.length, 0);
});
test('TGG selection ignores GTA6 videos and wrong channels', () => {
  const entry = (id, title, channel = TGG_CHANNEL) => `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>${title}</title><published>2026-09-16T10:00:00Z</published></entry>`;
  const xml = entry('aaaaaaaaaaa', 'GTA 6 update') + entry('bbbbbbbbbbb', 'GTA Online weekly update', 'fake') + entry('ccccccccccc', 'GTA Online weekly update');
  assert.equal(selectTggVideo(xml, Date.parse('2026-09-17')).videoId, 'ccccccccccc');
});

class Storage {
  data = new Map();
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix, limit }) { return new Map([...this.data].filter(([key]) => key.startsWith(prefix)).slice(0, limit)); }
  async getAlarm() { return this.alarm; }
  async setAlarm(at) { this.alarm = at; }
}
test('budget reservation persists before IO, cached transcript does not consume credits', async () => {
  const storage = new Storage();
  const svc = new SourceService(storage, {}, Date.parse('2026-09-17'));
  await svc.reserve('supadata:2026-09', 1, 1);
  await assert.rejects(() => svc.reserve('supadata:2026-09', 1, 1), /budget/);
  await storage.put('transcript:abcdefghijk', { chunks: [{ offset: 0, text: 'cached' }], cachedAt: Date.parse('2026-09-16') });
  assert.equal((await svc.transcript({ videoId: 'abcdefghijk' }))[0].text, 'cached');
});
test('coordinator recovers a KV crash, deduplicates publication and persists next date on failure', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T08:50:00Z') });
  t.mock.method(SourceService.prototype, 'websites', async () => ({ documents: [], failures: [], hasCurrentArticle: true }));
  const storage = new Storage(); let writes = 0, crash = true;
  const env = { PUBLICATION_MODE: 'publish', CONTENT_KV: {
    get: async () => legacy,
    put: async () => { writes++; if (crash) { crash = false; throw new Error('test-kv-crash'); } },
  } };
  let engine = new PublicationEngine({ storage }, env);
  await engine.alarm();
  const failed = await engine.status();
  assert.equal(failed.lastError, 'test-kv-crash');
  assert.ok(Date.parse(failed.nextRunAt) > Date.now());
  const intended = await storage.get('pending-publication');
  engine = new PublicationEngine({ storage }, env);
  await engine.alarm();
  assert.deepEqual(await storage.get('publication'), intended);
  await engine.alarm();
  assert.equal(writes, 2);
  assert.equal((await engine.outbox()).entries.length, 1);
});

test('a staged weekend override neither removes the current bonus early nor survives its expiry', async () => {
  const regular = { ...fact, startsOn: '2026-09-17', endsOn: '2026-09-23' };
  const weekend = { ...regular, offer: '3X GTA$ & RP', startsOn: '2026-09-18', endsOn: '2026-09-20' };
  let c = await mergeFacts(null, [regular, weekend], atLocal('2026-09-17', 700));
  assert.match(c.sections[0].items[0].label, /2X/);
  c = await mergeFacts(c, [regular, weekend], atLocal('2026-09-19', 700));
  assert.match(c.sections[0].items[0].label, /3X/);
  c = await mergeFacts(c, [regular, weekend], atLocal('2026-09-21', 700));
  assert.match(c.sections[0].items[0].label, /2X/);
});
test('known seasonal stage switches without a new article and preserves target count', async () => {
  const c = await mergeFacts(legacy, [], atLocal('2026-09-17', 660));
  assert.equal(c.weekId, '2026-09-17');
  assert.match(c.sections.find(s => s.id === 'challenge').items[0].label, /Bunker Research/);
  assert.equal(c.sections.find(s => s.id === 'challenge').items[0].targetCount, 3);
  const view = projectContent(c, atLocal('2026-09-17', 660));
  assert.equal(view.seasonalEvent.weeks[2].status, 'This week');
});
test('an exact source time is used, and an unsupported timezone/time cannot move a deadline', () => {
  const evidence = 'Contact Missions pay 2X GTA$ & RP, September 17 at 10:00 UTC through September 23 at 09:00 UTC';
  const f = { ...fact, evidence, dateEvidence: evidence, timing: { startsAt: '2026-09-17T10:00:00Z', expiresAt: '2026-09-23T09:00:00Z', originalZone: 'UTC', evidence } };
  const doc = { text: evidence, source: fact.sources[0] };
  assert.equal(Date.parse(validateFacts({ facts: [f] }, doc).facts[0].timing.startsAt), Date.parse(f.timing.startsAt));
  assert.equal(validateFacts({ facts: [{ ...f, timing: { ...f.timing, startsAt: '2026-09-17T11:00:00Z' } }] }, doc).facts.length, 0);
});

test('a check requested during source IO is scheduled immediately after that run', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T16:50:00Z') });
  const storage = new Storage();
  const engine = new PublicationEngine({ storage }, { PUBLICATION_MODE: 'observe', CONTENT_KV: { get: async () => legacy } });
  t.mock.method(SourceService.prototype, 'websites', async () => {
    await engine.requestCheck();
    return { documents: [], failures: [], hasCurrentArticle: true };
  });
  await engine.alarm();
  assert.equal(await storage.get('check-requested'), true);
  assert.equal(await storage.getAlarm(), Date.now() + 1000);
});

test('a reward cannot lose its qualifying requirement during extraction', () => {
  const f = { ...fact, evidence: 'Complete Contact Missions to earn 2X GTA$ & RP', offer: '2X GTA$ & RP' };
  const doc = { text: `${f.evidence}. ${f.dateEvidence}`, source: f.sources[0] };
  assert.equal(validateFacts({ facts: [f] }, doc).facts.length, 0);
});

test('source agreement retains multiple periods and an expired official period cannot block the next one', async () => {
  const weekend = { ...fact, startsOn: '2026-09-18', endsOn: '2026-09-20', offer: '3X GTA$ & RP' };
  const agreed = agreeSources([{ source: { kind: 'rockstar' }, facts: [fact, weekend] }], false);
  assert.equal(agreed.length, 2);
  const old = { ...fact, startsOn: '2026-09-17', endsOn: '2026-09-17' };
  const next = { ...weekend, confidence: 'corroborated' };
  const c = await mergeFacts(null, [old], atLocal('2026-09-17', 700));
  const updated = await mergeFacts(c, [old, next], atLocal('2026-09-18', 700));
  assert.match(projectContent(updated, atLocal('2026-09-18', 700)).sections[0].items[0].label, /3X/);
  let regular = await mergeFacts(null, [fact], atLocal('2026-09-17', 700));
  regular = await mergeFacts(regular, [fact, next], atLocal('2026-09-18', 700));
  assert.match(projectContent(regular, atLocal('2026-09-18', 700)).sections[0].items[0].label, /3X/);
  regular = await mergeFacts(regular, [fact, next], atLocal('2026-09-21', 700));
  assert.match(projectContent(regular, atLocal('2026-09-21', 700)).sections[0].items[0].label, /2X/);
});

test('transcript quota does not reset at a calendar month boundary', async () => {
  const storage = new Storage();
  const before = Date.parse('2026-09-30T18:00:00Z');
  const service = new SourceService(storage, {}, before);
  for (let i = 0; i < 95; i++) await service.reserveTranscriptCredit();
  await assert.rejects(() => new SourceService(storage, {}, before + 86400000).reserveTranscriptCredit(), /budget_exhausted/);
  await new SourceService(storage, {}, before + 32 * 86400000 + 1).reserveTranscriptCredit();
});

test('downloaded caption evidence survives an exhausted AI allowance', async t => {
  const storage = new Storage();
  t.mock.method(globalThis, 'fetch', async () => new Response(`<feed><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${TGG_CHANNEL}</yt:channelId><title>GTA Online weekly update</title><published>2026-09-16T10:00:00Z</published></entry></feed>`));
  t.mock.method(SourceService.prototype, 'transcript', async () => [{ text: 'The weekly update starts September 17.', offset: 12000 }]);
  t.mock.method(SourceService.prototype, 'extract', async () => { throw new Error('ai_free_budget_exhausted'); });
  await assert.rejects(() => new SourceService(storage, {}, Date.parse('2026-09-17')).tgg(), /budget_exhausted/);
  const check = await storage.get('transcript-check');
  assert.equal(check.status, 'downloaded');
  assert.equal(check.firstOffsetMs, 12000);
  assert.match(check.digest, /^[a-f0-9]{64}$/);
});

test('TGG probe waits for the UTC allowance reset and then resumes itself', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-15T18:00:00Z') });
  const storage = new Storage(); let calls = 0;
  t.mock.method(SourceService.prototype, 'websites', async () => ({ documents: [], failures: [], hasCurrentArticle: true }));
  t.mock.method(SourceService.prototype, 'tgg', async () => {
    if (++calls === 1) throw new Error('ai_free_budget_exhausted');
    return { source: { kind: 'tgg' }, facts: [], rejected: [] };
  });
  const engine = new PublicationEngine({ storage }, { PUBLICATION_MODE: 'observe', CONTENT_KV: { get: async () => legacy } });
  await engine.requestTggProbe();
  await engine.alarm();
  assert.equal((await engine.status()).tggProbe.retryAt, '2026-09-16T00:02:00.000Z');
  await engine.alarm();
  assert.equal(calls, 1);
  t.mock.timers.tick(Date.parse('2026-09-16T00:02:00Z') - Date.now());
  await engine.alarm();
  assert.equal(calls, 2);
  assert.equal(await storage.get('tgg-probe-requested'), undefined);
  assert.equal((await engine.status()).tggProbe.error, undefined);
});
