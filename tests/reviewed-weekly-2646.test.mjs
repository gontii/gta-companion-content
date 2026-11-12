import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFacts } from '../scripts/facts.mjs';
import { supplementReviewedFacts } from '../scripts/reviewed-weekly.mjs';
import { projectContent } from '../scripts/temporal.mjs';
import { inspectSectionCoverage } from '../scripts/section-coverage.mjs';

// Rockstar Newswire nie opublikował artykułu GTA Online dla 12–18.11.2026;
// zgodne RockstarINTEL i iGTA uzupełniają wyzwanie, nagrody i rotacje.
test('week 2646 reviewed facts fill challenge, podium, Prize Ride and other activities until the weekly reset', async () => {
  const at = Date.parse('2026-11-12T13:00Z');
  const master = await mergeFacts(null, supplementReviewedFacts(null, [], at), at);
  const snapshot = projectContent(master, at);
  const section = id => snapshot.sections.find(s => s.id === id).items;
  const challenge = section('challenge').find(i => i.entity === 'Stunt Races');
  assert.match(challenge.offer, /Win two Stunt Races to receive GTA\$100,000/);
  assert.equal(challenge.targetCount, 2);
  assert.ok(section('free-vehicles').some(i => i.entity === 'Karin Everon' && /Lucky Wheel/.test(i.offer)));
  assert.ok(section('free-vehicles').some(i => i.entity === 'Western Powersurge' && /LS Car Meet/.test(i.offer)));
  assert.ok(section('other').some(i => i.entity === 'FIB Priority File' && i.offer === 'The Brute Force File'));
  assert.equal(section('other').find(i => i.entity === 'HSW Time Trial').platform, 'enhanced');
  assert.equal(section('gun-van').find(i => i.entity === 'Armor').eligibility, 'gta-plus');
  for (const item of snapshot.sections.flatMap(s => s.items).filter(i => i.sources?.some(s => s.url.includes('november-12')))) {
    assert.equal(item.confidence, 'corroborated');
    assert.equal(item.expiresAt, '2026-11-19T10:00:00.000Z');
  }
  const coverage = inspectSectionCoverage({ ...snapshot, weekId: '2026-11-12' }, null, at, '2026-11-12', Date.parse('2026-11-12T10:00Z'));
  const state = id => coverage.areas.find(a => a.id === id).state;
  for (const id of ['challenge', 'podium', 'prize-ride', 'other', 'gun-van-discounts', 'gun-van-gta-plus']) assert.equal(state(id), 'confirmed', id);
  const later = projectContent(master, Date.parse('2026-11-19T11:00Z'));
  assert.ok(!later.sections.flatMap(s => s.items).some(i => ['Stunt Races', 'Karin Everon', 'Western Powersurge'].includes(i.entity)));
});
