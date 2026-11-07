import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { articleDocument, agreeSources, mergeFacts, validateFacts } from '../scripts/facts.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';
import { findIgtaWeekly } from '../scripts/additional-sources.mjs';
import { selectTggCandidate, SourceService, TGG_CHANNEL } from '../scripts/source-service.mjs';
import { fetchWithBackoff } from '../scripts/http.mjs';
import { stampCompleteness, inspectSectionCoverage, inspectBonusPeriods, REQUIRED_AREAS } from '../scripts/section-coverage.mjs';
import { parseWeeklyContent } from '../schemas/app-weekly-parser.mjs';
import { atLocal } from '../scripts/temporal.mjs';
import { createBundle } from '../scripts/publication-bundle.mjs';
import { hash } from '../scripts/facts.mjs';

const weeks = JSON.parse(await readFile(new URL('./fixtures/igta-week-structures.html.json', import.meta.url), 'utf8'));
const titles = JSON.parse(await readFile(new URL('./fixtures/tgg-weekly-titles.json', import.meta.url), 'utf8'));

const page = (weekId, body) => {
  const meta = weeks.weeks[weekId];
  return `<meta property="article:published_time" content="${meta.published}"><article><h1>${meta.title}</h1>${body}</article>`;
};
const parsed = (weekId, body, kind = 'igta') => {
  const meta = weeks.weeks[weekId];
  const doc = articleDocument({ kind, sourceUrl: kind === 'intel' ? 'https://rockstarintel.com/current' : meta.source, html: page(weekId, body) }, new Date(`${weekId}T12:00:00Z`));
  return { ...doc, ...extractWeeklyRotations(doc), current: true };
};
const offer = (doc, entity, includes) => doc.facts.find(f => f.entity === entity && (!includes || f.offer.includes(includes)));

test('iGTA discovery accepts ordinals and a trailing slash, and keeps the newest Thursday', () => {
  const older = '/gtaonline/news/this-week-in-gta-online-september-17-2026/';
  const newer = '/gtaonline/news/this-week-in-gta-online-october-29th-2026';
  const index = `<a href="${older}">old</a><a href="https://evil.example${newer}">off-origin</a><a href="${newer}?utm=1">query</a><a href="${newer}">new</a>`;
  assert.equal(findIgtaWeekly(index), 'https://www.igrandtheftauto.com' + newer);
  assert.equal(findIgtaWeekly('<a href="https://www.igrandtheftauto.com.evil.example' + newer + '">bad</a>'), null);
});

test('17.09 iGTA wording still yields podium, prize ride, discounts and both Gun Van prices', () => {
  const doc = parsed('2026-09-17', `
    <h2>Bonuses and Rewards</h2>
    <ul><li>2X GTA$ and RP on Ammu-Nation Contract Missions</li>
    <li>2X GTA$, RP, and Research Progress on Bunker Research Missions via Agent 14</li></ul>
    <h3>Premium Deluxe Motorsport Showroom – All 30% Off</h3>
    <ul><li>Ocelot XA-21 (Super)</li><li>Pegassi Torero (Sports Classic)</li></ul>
    <h3>The Diamond Casino and Resort Lucky Wheel</h3>
    <ul><li>Vapid Dominator ASP (Muscle)</li></ul>
    <h3>LS Car Meet Prize Ride</h3>
    <p>Win in the LS Car Meet Series for four days in a row to receive the Dinka LSCM Jester RR (Sports).</p>
    <h2>Gun Van Inventory</h2>
    <ul><li>Stun Gun – 40% off</li><li>Tactical SMG – 30% off for GTA+ Members</li><li>Heavy Sniper</li></ul>`);
  assert.equal(doc.period.startId, '2026-09-17');
  assert.equal(doc.period.endId, '2026-09-23');
  assert.ok(offer(doc, 'Vapid Dominator ASP', 'Podium'));
  assert.match(offer(doc, 'Dinka LSCM Jester RR').offer, /Prize Ride: win in the LS Car Meet Series for four days/);
  assert.ok(offer(doc, 'Ocelot XA-21', '30% off'));
  assert.ok(offer(doc, 'Stun Gun', '40% off'));
  assert.ok(offer(doc, 'Tactical SMG', '30% off') && offer(doc, 'Tactical SMG', '30% off').eligibility === 'gta-plus');
  assert.ok(offer(doc, 'Bunker Research Missions via Agent 14', '2X GTA$ & RP'));
  assert.ok(!doc.facts.some(f => f.entity === 'Heavy Sniper' && /off|FREE/.test(f.offer)));
});

test('08.10 percent-first Gun Van lines and the combined casino heading still agree with Intel', () => {
  const igta = parsed('2026-10-08', `
    <h2>Casino Podium and Prize Ride</h2>
    <p>Head to the Casino for a chance to win the Annis Savestra from the Lucky Wheel.</p>
    <p>Meanwhile, placing in the Top 4 in the LS Car Meet Series for two days in a row will unlock the Declasse Walton L35 as this week's Prize Ride.</p>
    <h2>Halloween Discounts</h2><ul><li>40% off – Albany Brigham</li></ul>
    <h2>Gun Van Inventory</h2>
    <ul><li>Free – The Shocker</li><li>30% off – Service Carbine</li><li>50% off for GTA+ Members – Widowmaker</li><li>El Strickler</li></ul>`);
  const intel = parsed('2026-10-08', `
    <p>October 8–14</p>
    <h3>Podium Vehicle</h3><p>Lucky Wheel for your chance to win the Annis Savestra, which costs money.</p>
    <h3>Prize Ride Challenge</h3><p>place top 4 in a LS Car Meet Race for 2 days in a row to unlock the Declasse Walton L35 as the Prize Ride vehicle.</p>
    <h3>Discounts:</h3><h5>40% off</h5><ul><li>Albany Brigham</li></ul>
    <h3>Gun Van Contents</h3><ul><li>The Shocker (FREE)</li><li>Service Carbine (30%, GTA+ 30%)</li><li>Widowmaker (10%, GTA+ 50%)</li><li>El Strickler (10%, GTA+ 20%)</li></ul>`, 'intel');
  const agreed = agreeSources([intel, igta], false);
  for (const [entity, offerText] of [['Annis Savestra', 'Podium'], ['Declasse Walton L35', 'top 4'], ['Albany Brigham', '40% off'], ['Service Carbine', '30% off'], ['Widowmaker', '50% off'], ['The Shocker', 'FREE']]) {
    assert.ok(agreed.some(f => f.entity === entity && f.offer.includes(offerText)), entity);
  }
  assert.ok(!agreed.some(f => f.entity === 'El Strickler'));
  assert.ok(agreed.find(f => f.entity === 'Widowmaker' && f.offer.includes('50%')).eligibility === 'gta-plus');
});

test('22.10 and 29.10 name-first lists, ampersand podium headings and Place in the Top still parse', () => {
  for (const [weekId, vehicle, rank, podium] of [
    ['2026-10-22', 'Grotti Itali Classic', '2', 'Pfister Comet S2'],
    ['2026-10-29', 'Karin Previon', '5', 'Progen GP1'],
  ]) {
    const doc = parsed(weekId, `
      <h2>Halloween Bonuses</h2>
      <ul><li>3X GTA$ and RP on Halloween Featured Series:<ul><li>Slasher</li></ul></li>
      <li>2X GTA$ on Ghosts Exposed (4X for GTA+ Members)</li></ul>
      <h2>Halloween Discounts – 40% Off</h2>
      <ul><li>Agency Properties – 40% off</li><li>Albany Brigham (Muscle) – 40% off</li></ul>
      <h2>Additional Vehicle Discounts – 30% Off</h2>
      <ul><li>Pfister Astron (SUV) – 30% off</li></ul>
      <h3>Luxury Autos Showroom</h3><ul><li>Dewbauchee Rapid GT X (Sports)</li></ul>
      <h3>The Diamond Casino &amp; Resort Lucky Wheel</h3><ul><li>${podium} (Super)</li></ul>
      <h3>LS Car Meet Prize Ride</h3>
      <p>Place in the Top ${rank} in the LS Car Meet Series for two days in a row to win the ${vehicle} (Sports Classic).</p>
      <h2>Gun Van Inventory</h2>
      <ul><li>The Shocker – Free</li><li>Service Carbine – 30% off</li>
      <li>Widowmaker – 50% off for GTA+ Members</li><li>Precision Rifle</li><li>El Strickler</li></ul>
      <h2>Showroom Vehicles</h2><ul><li>Unrelated Vehicle</li></ul>`);
    assert.equal(doc.period.startId, weekId);
    assert.ok(offer(doc, podium, 'Podium'), podium);
    assert.match(offer(doc, vehicle).offer, new RegExp(`Place top ${rank} .* two days`));
    assert.ok(offer(doc, 'Agency Properties', '40% off'));
    assert.ok(offer(doc, 'Albany Brigham', '40% off'));
    assert.ok(offer(doc, 'Pfister Astron', '30% off'));
    assert.ok(offer(doc, 'Dewbauchee Rapid GT X', '30% off'));
    assert.ok(offer(doc, 'The Shocker', 'FREE'));
    assert.equal(offer(doc, 'Service Carbine', '30% off').eligibility, 'all');
    assert.equal(offer(doc, 'Widowmaker', '50% off').eligibility, 'gta-plus');
    assert.ok(offer(doc, 'Halloween Featured Series', '3X'));
    assert.equal(offer(doc, 'Ghosts Exposed', '2X').eligibility, 'all');
    assert.equal(offer(doc, 'Ghosts Exposed', '4X').eligibility, 'gta-plus');
    assert.ok(!doc.facts.some(f => f.entity === 'Unrelated Vehicle' || f.entity === 'El Strickler' || f.entity === 'Slasher'));
  }
});

test('recent TGG titles stay eligible and GTA 6, guides and unrelated videos do not', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  for (const title of titles.accept) {
    const video = { videoId: 'aaaaaaaaaaa', channelId: TGG_CHANNEL, publishedOn: '2026-10-28T22:06:20Z', title };
    assert.equal(selectTggCandidate([video], now)?.videoId, video.videoId, title);
  }
  for (const title of titles.reject) {
    const video = { videoId: 'aaaaaaaaaaa', channelId: TGG_CHANNEL, publishedOn: '2026-10-28T22:06:20Z', title };
    assert.equal(selectTggCandidate([video], now), null, title);
  }
});

test('subtitle 429s back off, then reuse the cached transcript instead of calling again', async () => {
  const calls = [];
  const fetchImpl = async () => {
    calls.push('fetch');
    return new Response('busy', { status: 429, headers: { 'retry-after': '30' } });
  };
  const first = await fetchWithBackoff('https://api.supadata.ai/v1/transcript', {}, fetchImpl, { retries: 0, sleepImpl: async () => {}, now: 0 });
  assert.equal(first.status, 429);
  assert.equal(calls.length, 1);
  const storage = new Map();
  const memory = { get: async key => storage.get(key), put: async (key, value) => storage.set(key, value), delete: async key => storage.delete(key), list: async () => new Map() };
  let hits = 0;
  const live = async () => {
    hits++;
    if (hits < 3) return new Response('rate', { status: 429, headers: { 'retry-after': '1' } });
    return Response.json({ content: [{ text: 'Podium vehicle this week.', offset: 1000 }] });
  };
  const globalFetch = globalThis.fetch;
  globalThis.fetch = live;
  try {
    const service = new SourceService(memory, { SUPADATA_API_KEY: 'test-only' }, Date.parse('2026-10-29T08:00:00Z'));
    const chunks = await service.transcript({ videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    assert.equal(chunks[0].text, 'Podium vehicle this week.');
    assert.equal(hits, 3);
    hits = 0;
    memory.set?.('subtitle-429:abcdefghijk', { nextAt: Date.parse('2026-10-29T09:00:00Z'), cachedAt: Date.parse('2026-10-29T08:00:00Z') });
    await memory.put('subtitle-429:abcdefghijk', { nextAt: Date.parse('2026-10-29T09:00:00Z'), cachedAt: Date.parse('2026-10-29T08:00:00Z') });
    const again = new SourceService(memory, { SUPADATA_API_KEY: 'test-only' }, Date.parse('2026-10-29T08:30:00Z'));
    assert.equal((await again.transcript({ videoId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' }))[0].offset, 1000);
    assert.equal(hits, 0);
  } finally { globalThis.fetch = globalFetch; }
});

test('a rate-limited TGG feed reuses the cached weekly video and does not spend a search credit', async () => {
  const storage = new Map();
  const memory = { get: async key => storage.get(key), put: async (key, value) => storage.set(key, value), delete: async key => storage.delete(key), list: async () => new Map() };
  const candidate = { videoId: '5xy1qyPrK28', title: 'TRIPLE MONEY, LIMITED TIME VEHICLES & DISCOUNTS | GTA Online Weekly Update - Halloween Event', publishedOn: '2026-10-28T22:06:20Z', url: 'https://www.youtube.com/watch?v=5xy1qyPrK28', kind: 'tgg' };
  await memory.put('tgg-discovery-v3', { candidate, checkedAt: Date.parse('2026-10-29T01:00:00Z'), expiresAt: Date.parse('2026-10-29T02:00:00Z') });
  let searches = 0;
  const globalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname === 'www.youtube.com') return new Response('slow', { status: 429, headers: { 'retry-after': '60' } });
    searches++;
    return Response.json({ results: [] });
  };
  try {
    const service = new SourceService(memory, { SUPADATA_API_KEY: 'test-only' }, Date.parse('2026-10-29T08:00:00Z'));
    assert.equal((await service.discoverTgg()).videoId, candidate.videoId);
    assert.equal(searches, 0);
    const blocked = new SourceService(memory, { SUPADATA_API_KEY: 'test-only' }, Date.parse('2026-10-29T08:10:00Z'));
    assert.equal((await blocked.discoverTgg()).videoId, candidate.videoId);
    assert.equal(searches, 0);
  } finally { globalThis.fetch = globalFetch; }
});

test('Contact Missions 2x for 5–11 Nov stays in that week and the 12 Nov 4x does not', async () => {
  const html = `<meta property="article:published_time" content="2026-11-04"><article><h1>This Week in GTA Online: November 5, 2026</h1>
    <p>November 5–11</p>
    <h2>Bonuses</h2>
    <ul>
      <li>2X GTA$ and RP on Contact Missions (November 5–11)</li>
      <li>4X GTA$ and RP on Contact Missions (November 12–December 2)</li>
    </ul>
    <h2>From November 12 through December 2</h2>
    <ul><li>2X GTA$ and RP on Sumo Remix</li></ul>
  </article>`;
  const doc = articleDocument({ kind: 'igta', sourceUrl: 'https://www.igrandtheftauto.com/gtaonline/news/this-week-in-gta-online-november-5-2026', html }, new Date('2026-11-07T12:00:00Z'));
  const extracted = extractWeeklyRotations(doc);
  const two = extracted.facts.find(f => f.entity === 'Contact Missions' && f.offer.startsWith('2X'));
  const four = extracted.facts.find(f => f.entity === 'Contact Missions' && f.offer.startsWith('4X'));
  const sumo = extracted.facts.find(f => f.entity === 'Sumo Remix');
  assert.deepEqual([two.startsOn, two.endsOn], ['2026-11-05', '2026-11-11']);
  assert.deepEqual([four.startsOn, four.endsOn], ['2026-11-12', '2026-12-02']);
  assert.deepEqual([sumo.startsOn, sumo.endsOn], ['2026-11-12', '2026-12-02']);
  const sourced = extracted.facts.filter(f => f.section === 'bonuses').map(f => ({ ...f, confidence: 'corroborated', sources: [{ kind: 'intel', url: 'https://rockstarintel.com/current' }] }));
  const during = await mergeFacts(null, sourced, Date.parse('2026-11-07T12:00:00Z'));
  const labels = during.sections.find(s => s.id === 'bonuses').items.map(i => i.label);
  assert.deepEqual(labels.filter(label => /Contact Missions|Sumo/.test(label)), ['Contact Missions — 2X GTA$ & RP']);
  assert.ok(during.withheldBonuses.some(bonus => bonus.entity === 'Contact Missions' && bonus.offer.startsWith('4X') && bonus.reason === 'future' && bonus.startsOn === '2026-11-12'));
  assert.ok(!labels.some(label => /4X|Sumo/.test(label)));
  const next = await mergeFacts(during, sourced, Date.parse('2026-11-12T12:00:00Z'));
  const nextLabels = next.sections.find(s => s.id === 'bonuses').items.map(i => i.label);
  assert.ok(nextLabels.some(label => label === 'Contact Missions — 4X GTA$ & RP'));
  assert.ok(nextLabels.some(label => label === 'Sumo Remix — 2X GTA$ & RP'));
  assert.ok(!nextLabels.some(label => /Contact Missions — 2X/.test(label)));
  const mismatch = validateFacts({ facts: [{ ...four, startsOn: '2026-11-05', endsOn: '2026-11-11', dateEvidence: 'November 5-11' }] }, doc);
  assert.equal(mismatch.facts.length, 0);
  assert.equal(mismatch.rejected[0].reason, 'bonus_period_mismatch');
  const illegal = structuredClone(during);
  illegal.sections.find(s => s.id === 'bonuses').items.push({ id: 'future-4x', label: 'Contact Missions — 4X GTA$ & RP', startsAt: '2026-11-12T10:00:00.000Z', expiresAt: '2026-12-03T10:00:00.000Z' });
  illegal.sections.find(s => s.id === 'bonuses').items.push({ id: 'undated', label: 'Contact Missions — 3X GTA$ & RP' });
  const issues = inspectBonusPeriods(illegal);
  assert.deepEqual(issues.map(issue => issue.reason).sort(), ['missing-dates', 'outside-week']);
  const coverage = inspectSectionCoverage(illegal, null, Date.parse('2026-11-07T12:00:00Z'), illegal.weekId, atLocal(illegal.weekId, 11 * 60));
  stampCompleteness(illegal, coverage);
  assert.ok(illegal.bonusPeriodIssues.length >= 2);
  assert.equal(illegal.completeness, 'partial');
  assert.ok(!illegal.sections.find(s => s.id === 'bonuses').items.some(item => item.id === 'future-4x' || item.id === 'undated'));
  assert.match(illegal.completenessNote, /Contact Missions — 4X/);
});

test('a partial edition still publishes with the missing areas named, and 11/11 clears the flag', async () => {
  const week = '2026-10-29';
  const expected = atLocal(week, 11 * 60);
  const item = (id, label) => ({ id, label, startsAt: new Date(expected).toISOString(), expiresAt: new Date(atLocal('2026-11-05', 11 * 60)).toISOString(), sourceUrl: 'https://rockstarintel.com/current', sources: [{ kind: 'intel', url: 'https://rockstarintel.com/current' }] });
  const snapshot = {
    schemaVersion: 2, weekId: week, range: '2026-10-29 – 2026-11-04', headline: 'This week in GTA Online',
    startsAt: new Date(expected).toISOString(), expiresAt: new Date(atLocal('2026-11-05', 11 * 60)).toISOString(),
    quickTake: ['Bonus'], quickTakeEntries: [], beginnerPath: [], locations: [], sources: [{ kind: 'intel', url: 'https://rockstarintel.com/current' }],
    sections: [
      { id: 'bonuses', title: 'Best bonuses', items: [item('b', 'Contact Missions — 2X GTA$ & RP')] },
      { id: 'challenge', title: 'Weekly challenge', items: [item('c', 'Survival — Complete ten waves')] },
      { id: 'free-vehicles', title: 'Free rewards & prize vehicles', items: [item('r', 'Skull Mask — FREE for logging in')] },
      { id: 'discounts', title: 'Discounts & Offers', items: [] },
      { id: 'gun-van', title: 'Gun Van', items: [item('g', 'Knife — In stock')] },
      { id: 'other', title: 'Other weekly items', items: [item('o', 'Time Trial — East Vinewood')] },
      { id: 'gta-plus', title: 'GTA+ benefits', items: [item('p', 'GTA+ — 500,000 GTA$')] },
    ],
  };
  const viewed = atLocal(week, 13 * 60);
  const coverage = inspectSectionCoverage(snapshot, null, viewed, week, expected);
  stampCompleteness(snapshot, coverage);
  assert.equal(snapshot.completeness, 'partial');
  assert.ok(snapshot.missingAreas.includes('podium'));
  assert.ok(snapshot.missingAreas.includes('prize-ride'));
  assert.ok(snapshot.missingAreas.includes('discounts'));
  assert.ok(snapshot.missingAreas.includes('gun-van-discounts'));
  assert.match(snapshot.completenessNote, /Partial weekly update 2026-10-29: \d+\/11/);
  snapshot.generatedAt = new Date(viewed).toISOString();
  snapshot.revision = await hash(snapshot);
  for (const section of snapshot.sections) for (const entry of section.items) Object.assign(entry, { confidence: 'corroborated', eligibility: 'all', platform: 'all', offer: entry.label.split(' — ')[1] || entry.label, entity: entry.label.split(' — ')[0] });
  snapshot.quickTakeEntries = snapshot.sections.flatMap(s => s.items).slice(0, 1);
  snapshot.beginnerPath = [{ ...snapshot.sections[1].items[0], id: 'bp-c', itemIds: ['c'] }];
  const bundle = await createBundle(snapshot, null, viewed);
  const article = bundle.values[0];
  assert.ok(parseWeeklyContent(bundle.values[1]));
  assert.equal(bundle.values[1].completeness, 'partial');
  assert.ok(article.sections.find(s => s.id === 'discounts').items.some(i => i.status === 'pending'));
  assert.ok(article.sections.find(s => s.id === 'rotations').items.some(i => i.status === 'pending' && /podium|prize-ride|gun-van/.test(i.name)));
  const full = structuredClone(snapshot);
  full.sections.find(s => s.id === 'free-vehicles').items.push(item('pod', 'Grotti Itali — Podium vehicle: chance to win at the Lucky Wheel'), item('ride', 'Karin Previon — Prize Ride: LS Car Meet'));
  full.sections.find(s => s.id === 'discounts').items.push(item('d', 'Agency — 40% off'));
  full.sections.find(s => s.id === 'gun-van').items.push(item('gd', 'Service Carbine — 30% off at the Gun Van'), item('gp', 'Widowmaker — 50% off at the Gun Van (GTA+ only)'));
  const done = inspectSectionCoverage(full, null, viewed, week, expected);
  stampCompleteness(full, done);
  assert.equal(done.resolvedAreas, REQUIRED_AREAS.length);
  assert.equal(full.completeness, 'complete');
  assert.deepEqual(full.missingAreas, []);
});
