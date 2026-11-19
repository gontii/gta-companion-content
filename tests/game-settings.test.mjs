import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyRotationFallback } from '../scripts/game-settings.mjs';
import { mergeFacts } from '../scripts/facts.mjs';
import { compatibleAppSnapshot, createBundle } from '../scripts/publication-bundle.mjs';
import { projectContent } from '../scripts/temporal.mjs';
import { supplementReviewedFacts } from '../scripts/reviewed-weekly.mjs';

const week = '2026-11-19';
const at = Date.parse(week + 'T10:30Z');
const values = { CASINO_PRIZE_VEHICLE_MODEL_HASH: 'BALLER8', CAR_MEET_PRIZE_VEHICLE_MODEL_HASH: 'SM722',
  CAR_MEET_PRIZE_VEHICLE_CHALLENGE_ID: 0, CAR_MEET_PRIZE_VEHICLE_CHALLENGE_PARAM_ONE: 1,
  CAR_MEET_PRIZE_VEHICLE_CHALLENGE_PARAM_TWO: 3, MP_WEEKLY_OBJECTIVE_ID_OVERRIDE: 64, MP_WEEKLY_OBJECTIVE_COUNT_OVERRIDE: 3 };
const labels = { BALLER8: 'Gallivanter Baller ST-D', SM722: 'Benefactor SM722', AMWO_OBJ_64: "~a~Complete ~1~ Gerald's Last Play Missions" };
function fixture(change = {}) {
  const cache = new Map();
  const latest = { date: week, hash: 'A'.repeat(40), updated: at / 1000 - 100, weekly_event_id: 525, ...change.index };
  const read = async url => {
    if (url.endsWith('/labels.json')) return labels;
    if (url.endsWith('/weekly_objectives.json')) return { 64: ['AMWO_OBJ_64', 3] };
    if (url.endsWith('/all.json')) return { latest, all: [latest] };
    return { ...latest, contents: { tunables: { BASE_GLOBALS: { ...values, ...(url.includes('/ps4/') ? change.ps4 : {}) } } } };
  };
  return { read, storage: { get: key => cache.get(key), put: (key, value) => cache.set(key, value) } };
}
test('only matching post-reset game settings fill missing slots, with compatible evidence on the public edition', async () => {
  const { read, storage } = fixture();
  const facts = await weeklyRotationFallback(storage, [], at, read);
  assert.deepEqual(facts.map(f => f.entity), ['Gallivanter Baller ST-D','Benefactor SM722',"Gerald's Last Play Missions"]);
  assert.match(facts[1].offer, /Win a race.*3 consecutive days/);
  assert.equal(facts[2].targetCount, 3);
  const missed = await weeklyRotationFallback(storage, [facts[2]], at, () => assert.fail('unexpected network access'));
  assert.equal(missed.length, 2);
  const snap = projectContent(await mergeFacts(null, facts, at), at);
  snap.generatedAt = new Date(at).toISOString(); snap.revision = 'c'.repeat(64);
  const bundle = await createBundle(snap, null, at);
  assert.ok(bundle.values[0].sources.every(s => s.url.startsWith('https://api.rdo.gg/tunables/gta/')));
  assert.ok(bundle.values[1].sections.flatMap(s => s.items).every(i => i.sourceUrl.endsWith('/2647#sources')));
  const incomplete = structuredClone(snap);
  incomplete.sections.find(s => s.items.length).items[0].sources.pop();
  assert.throws(() => compatibleAppSnapshot(incomplete), /app_compatible_source_missing/);
});
test('old snapshots and platform disagreements cannot confirm a rotation', async () => {
  const stale = fixture({index:{date:'2026-11-12'}});
  await assert.rejects(weeklyRotationFallback(stale.storage, [], at, stale.read), /reset_unconfirmed/);
  const conflict = fixture({ps4:{CASINO_PRIZE_VEHICLE_MODEL_HASH:'EVERON',CAR_MEET_PRIZE_VEHICLE_CHALLENGE_PARAM_TWO:2}});
  assert.deepEqual((await weeklyRotationFallback(conflict.storage, [], at, conflict.read)).map(f => f.section), ['challenge']);
});
test('ongoing general bonuses cross the Thursday reset with original validity and do not revive expired vehicles', async () => {
  const before = Date.parse(week + 'T09:59:59Z');
  const old = await mergeFacts(null, supplementReviewedFacts(null, [], before), before);
  const after = projectContent(await mergeFacts(old, [], before + 1000), before + 1000);
  assert.equal(old.weekId,'2026-11-12');
  assert.equal(after.weekId,week);
  assert.ok(after.sections.find(s => s.id === 'bonuses').items.some(i => i.entity === 'All Contact Missions' && i.expiresAt.startsWith('2026-12-02')));
  assert.equal(after.sections.find(s => s.id === 'free-vehicles').items.length,0);
});
