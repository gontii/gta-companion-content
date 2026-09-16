import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atLocal, nextCheck, localParts, windowFromDays, collectEvents, projectContent, normalizeWeeklyTiming } from '../scripts/temporal.mjs';
import { agreeSources, mergeFacts, validateFacts, upgradeLegacy, validateSnapshot, factWindow } from '../scripts/facts.mjs';
import { selectTggVideo, TGG_CHANNEL, SourceService } from '../scripts/source-service.mjs';
import { PublicationEngine } from '../worker/coordinator.mjs';

// Production history is updated by the relay; migration tests need an immutable legacy fixture.
const legacy = JSON.parse(await readFile(new URL('./fixtures/weekly-legacy.json', import.meta.url)));
const fact = {
  section: 'bonuses', entity: 'Contact Missions', offer: '2X GTA$ & RP', eligibility: 'all', platform: 'all',
  startsOn: '2026-09-17', endsOn: '2026-09-23', evidence: 'Contact Missions pay 2X GTA$ & RP', dateEvidence: 'September 17–23',
  sources: [{ kind: 'rockstar', url: 'https://www.rockstargames.com/newswire/article/example' }], confidence: 'official',
};
test('Warsaw schedule handles summer/winter, Tue/Wed/Thu, Sunday expiry and no UTC drift', () => {
  assert.equal(new Date(atLocal('2026-09-17', 650)).toISOString(), '2026-09-17T08:50:00.000Z');
  assert.equal(new Date(atLocal('2026-12-17', 650)).toISOString(), '2026-12-17T09:50:00.000Z');
  for (const date of ['2026-09-15', '2026-09-16']) {
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
test('Wednesday evening check runs at 19:00 Warsaw in summer and winter, even without pending news', () => {
  for (const [date, utc] of [['2026-09-23', '2026-09-23T17:00:00.000Z'], ['2026-12-16', '2026-12-16T18:00:00.000Z']]) {
    for (const pending of [false, true]) {
      const check = nextCheck(atLocal(date, 18 * 60 + 59), [], pending);
      assert.equal(new Date(check.at).toISOString(), utc);
      assert.equal(check.reason, 'Środowa kontrola o 19:00');
      assert.ok(nextCheck(check.at, [], pending).at > check.at);
    }
    assert.equal(nextCheck(atLocal(date, 12 * 60 + 6)).at, atLocal(date, 19 * 60));
  }
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
test('reviewed GTA+ periods survive a weekly reset and expire at their own boundary', async () => {
  const seed = structuredClone(legacy);
  seed.sections.find(s => s.id === 'gta-plus').items = [{ id: 'gta-plus-2026-09-cluckin',
    label: 'GTA+ only: first weekly finale earns 2X GTA$, September 10–October 7.' }];
  const migrated = upgradeLegacy(seed);
  const item = migrated.sections.find(s => s.id === 'gta-plus').items[0];
  assert.equal(item.expiresAt, '2026-10-07T22:00:00.000Z');
  const next = await mergeFacts(migrated, [fact], atLocal('2026-09-17', 700));
  assert.equal(projectContent(next, atLocal('2026-09-17', 700)).sections.find(s => s.id === 'gta-plus').items[0].id, item.id);
  assert.equal(projectContent(next, Date.parse(item.expiresAt)).sections.find(s => s.id === 'gta-plus').items.length, 0);
  const expiredWeek = next.sections.find(s => s.id === 'discounts').items;
  assert.ok(!expiredWeek.some(i => i.id === 'grapeseed-clubhouse-free'));
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
test('membership article cannot silently turn a member offer into an all-player bonus', () => {
  const doc = { text: `${fact.evidence}. ${fact.dateEvidence}`, source: { ...fact.sources[0], scope: 'membership' } };
  const result = validateFacts({ facts: [fact] }, doc);
  assert.equal(result.facts.length, 0);
  assert.equal(result.rejected[0].reason, 'membership_source_scope');
});
test('current article period cannot override a different quoted event period', () => {
  const f = { ...fact, dateEvidence: 'September 10–16' };
  const doc = { text: `${fact.evidence}. ${f.dateEvidence}`, source: fact.sources[0],
    period: { startId: fact.startsOn, endId: fact.endsOn } };
  assert.equal(validateFacts({ facts: [f] }, doc).rejected[0].reason, 'unsupported_dates');
});
test('known weekly challenge keeps its checklist id and does not duplicate extracted or seasonal facts', async () => {
  const extracted = { ...fact, section: 'challenge', entity: 'MC Business or Acid Lab product',
    startsOn: '2026-09-10', endsOn: '2026-09-16' };
  let c = await mergeFacts(legacy, [extracted], atLocal('2026-09-16', 700));
  let items = projectContent(c, atLocal('2026-09-16', 700)).sections.find(s => s.id === 'challenge').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'business-rivalries-2026-09-10');
  c = await mergeFacts(c, [extracted], atLocal('2026-09-17', 660));
  items = projectContent(c, atLocal('2026-09-17', 660)).sections.find(s => s.id === 'challenge').items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'business-rivalries-2026-09-17');
  assert.equal(items[0].targetCount, 3);
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
test('observation refreshes editorial corrections from live content before writer cutover', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T08:50:00Z') });
  t.mock.method(SourceService.prototype, 'websites', async () => ({ documents: [], failures: [], hasCurrentArticle: true }));
  const storage = new Storage(); let live = structuredClone(legacy);
  const engine = new PublicationEngine({ storage }, { PUBLICATION_MODE: 'observe', CONTENT_KV: { get: async () => live } });
  await engine.alarm();
  live.sections[0].items[0].label = 'Reviewed editorial correction';
  await engine.requestCheck(); await engine.alarm();
  const status = await engine.status();
  assert.equal(status.candidate.sections[0].items[0].label, 'Reviewed editorial correction');
  assert.equal(status.candidate.sections[0].items[0].editorial, undefined);
  assert.equal((await engine.outbox()).entries.length, 0);
});
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
  for (let i = 0; i < 95; i++) await service.reserveSupadataCredit();
  await assert.rejects(() => new SourceService(storage, {}, before + 86400000).reserveSupadataCredit(), /budget_exhausted/);
  await new SourceService(storage, {}, before + 32 * 86400000 + 1).reserveSupadataCredit();
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


test('search finds a TGG weekly video pushed out of RSS and rejects matching titles from other channels', async t => {
  const storage = new Storage(); let searches = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const url = new URL(input);
    if (url.hostname === 'www.youtube.com') return new Response('<feed/>');
    if (url.pathname === '/v1/metadata') return Response.json({ platform: 'youtube', type: 'video', id: 'bbbbbbbbbbb',
      title: 'GTA Online weekly update', createdAt: '2026-09-16T10:00:00Z', additionalData: { channelId: TGG_CHANNEL } });
    searches++;
    assert.equal(url.pathname, '/v1/youtube/search');
    assert.equal(url.searchParams.has('limit'), false);
    assert.equal(url.searchParams.get('sortBy'), 'relevance');
    return Response.json({ results: [
      { type: 'video', id: 'aaaaaaaaaaa', title: 'GTA Online weekly update', uploadDate: '2026-09-16T11:00:00Z', channel: { id: 'fake' } },
      { type: 'video', id: 'bbbbbbbbbbb', title: 'GTA Online weekly update', uploadDate: '1 day ago', channel: { id: TGG_CHANNEL } },
    ] });
  });
  const service = new SourceService(storage, { SUPADATA_API_KEY: 'test-only' }, Date.parse('2026-09-17'));
  assert.equal((await service.discoverTgg()).videoId, 'bbbbbbbbbbb');
  assert.equal((await service.discoverTgg()).videoId, 'bbbbbbbbbbb');
  assert.equal(searches, 1);
  assert.equal((await storage.get('tgg-discovery-check')).tggVideos, 1);
});


test('search cannot accept a relative date when metadata identifies another channel or an expired upload', async t => {
  for (const incorrect of [{ channelId: 'different-channel', createdAt: '2026-09-16T10:00:00Z' },
    { channelId: TGG_CHANNEL, createdAt: '2026-08-01T10:00:00Z' }]) {
    const storage = new Storage();
    const mock = t.mock.method(globalThis, 'fetch', async input => {
      const url = new URL(input);
      if (url.hostname === 'www.youtube.com') return new Response('<feed></feed>');
      if (url.pathname === '/v1/youtube/search') return Response.json({ results: [
        { type: 'video', id: 'bbbbbbbbbbb', title: 'GTA Online weekly update', uploadDate: '1 day ago', channel: { id: TGG_CHANNEL } },
      ] });
      return Response.json({ platform: 'youtube', type: 'video', id: 'bbbbbbbbbbb', title: 'GTA Online weekly update',
        createdAt: incorrect.createdAt, additionalData: { channelId: incorrect.channelId } });
    });
    await assert.rejects(() => new SourceService(storage, { SUPADATA_API_KEY: 'test' }, Date.parse('2026-09-17T08:50:00Z')).discoverTgg(), /tgg_relevant_video_missing/);
    mock.mock.restore();
  }
});


test('Thursday checks are half-hourly 08–12 plus preparation at 10:50, across DST', () => {
  for (const date of ['2026-09-17', '2026-12-17']) for (const pending of [false, true]) {
    const slots = []; let cursor = atLocal(date, 479);
    while (true) {
      const next = nextCheck(cursor, [], pending);
      if (next.at > atLocal(date, 720)) break;
      slots.push(localParts(next.at).minutes); cursor = next.at;
    }
    assert.deepEqual(slots, [480, 510, 540, 570, 600, 630, 650, 660, 690, 720]);
    assert.notEqual(localParts(nextCheck(cursor, [], pending).at).minutes, 725);
  }
});
test('September 16 has exactly four evening checks without duplicate pending polling', () => {
  for (const pending of [false, true]) {
    const slots = []; let cursor = atLocal('2026-09-16', 1019);
    while (true) {
      const next = nextCheck(cursor, [], pending);
      if (next.at > atLocal('2026-09-16', 1259)) break;
      slots.push(localParts(next.at).minutes); cursor = next.at;
    }
    assert.deepEqual(slots, [1020, 1080, 1140, 1200]);
  }
  assert.equal(nextCheck(atLocal('2026-09-23', 1019)).at, atLocal('2026-09-23', 1140));
});
function midnightSnapshot() {
  const c = upgradeLegacy(legacy);
  const visit = v => {
    if (!v || typeof v !== 'object') return;
    if (v.expiresAt === '2026-09-17T09:00:00.000Z') v.expiresAt = '2026-09-16T22:00:00.000Z';
    Object.values(v).forEach(visit);
  };
  visit(c); return c;
}
test('old schema-v2 weekly cache survives midnight and expires at 11 without changing ids', () => {
  const old = midnightSnapshot(), id = old.sections[0].items[0].id;
  const repaired = normalizeWeeklyTiming(old);
  assert.equal(old.expiresAt, '2026-09-16T22:00:00.000Z');
  assert.equal(repaired.expiresAt, '2026-09-17T09:00:00.000Z');
  assert.deepEqual(normalizeWeeklyTiming(repaired), repaired);
  for (const time of ['2026-09-16T22:00:00Z', '2026-09-17T08:59:59Z']) {
    assert.ok(projectContent(old, Date.parse(time)).sections[0].items.some(i => i.id === id));
  }
  assert.ok(!projectContent(old, Date.parse('2026-09-17T09:00:00Z')).sections[0].items.some(i => i.id === id));
  const exact = structuredClone(old);
  exact.sections[0].items[0].timingConfidence = 'confirmed';
  exact.sections[0].items[0].precision = 'time';
  assert.equal(normalizeWeeklyTiming(exact).sections[0].items[0].expiresAt, old.sections[0].items[0].expiresAt);
  assert.equal(factWindow({ ...fact, sources: [{ scope: 'membership' }] }).expiresAt, '2026-09-23T22:00:00.000Z');
  assert.equal(factWindow({ ...fact, windowPolicy: 'independent' }).expiresAt, '2026-09-23T22:00:00.000Z');
});
test('migration replaces stored midnight alarms, keeps unrelated events, rearms today, and avoids source IO', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-16T12:00:00Z') });
  const storage = new Storage(), old = midnightSnapshot();
  const events = collectEvents(old, [], Date.now());
  const seasonalKey = `${old.seasonalEvent.id}/2026-09-10:expiresAt:${Date.parse(old.expiresAt)}`;
  events.push({ key: seasonalKey, at: Date.parse(old.expiresAt), kind: 'expire', confidence: 'estimated' });
  events.push({ key: `${old.weekId}/sections/challenge/items/removed-from-an-older-revision:expiresAt:${Date.parse(old.expiresAt)}`, at: Date.parse(old.expiresAt), kind: 'expire', confidence: 'estimated' });
  events.push({ key: 'separate-event', at: atLocal('2026-09-18', 1) });
  await storage.put('master', old);
  await storage.put('state', { events, sources: [{ kind: 'rockstar', scope: 'weekly', current: true, facts: 1 }], nextCheck: { at: atLocal('2026-09-16', 1140) } });
  await storage.setAlarm(atLocal('2026-09-16', 1140));
  t.mock.method(SourceService.prototype, 'websites', async () => { throw new Error('unexpected source call'); });
  let published;
  const engine = new PublicationEngine({ storage }, { PUBLICATION_MODE: 'publish', CONTENT_KV: { put: async (_, json) => { published = JSON.parse(json); } } });
  await engine.wake();
  assert.equal(await storage.getAlarm(), Date.now() + 1000);
  await engine.alarm();
  const state = await storage.get('state');
  assert.equal(state.lastError, null);
  assert.equal(state.nextCheck.at, atLocal('2026-09-16', 1020));
  assert.ok(!state.events.some(e => e.at === Date.parse(old.expiresAt)));
  assert.ok(state.events.some(e => e.key === 'separate-event'));
  assert.equal(published.expiresAt, '2026-09-17T09:00:00.000Z');
  assert.ok(await storage.get('archived-timing:1'));
});
test('source refresh at 08:00 retains weekly facts until 11:00 instead of pruning at UTC midnight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T06:00:00Z') });
  const storage = new Storage();
  await storage.put('fact:keep', fact);
  t.mock.method(SourceService.prototype, 'websites', async () => ({ documents: [], failures: [], hasCurrentArticle: true }));
  const engine = new PublicationEngine({ storage }, { PUBLICATION_MODE: 'publish', CONTENT_KV: { get: async () => null, put: async () => {} } });
  await engine.alarm();
  assert.ok(await storage.get('fact:keep'));
  assert.ok((await engine.status()).candidate.sections[0].items.some(i => i.label.includes('Contact Missions')));
  assert.equal((await engine.status()).lastError, null);
});
