import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementReviewedFacts, normalizeReviewedSources } from '../scripts/reviewed-weekly.mjs';
import { mergeFacts, validateSnapshot } from '../scripts/facts.mjs';
import { projectContent } from '../scripts/temporal.mjs';

test('zatwierdzone nagrody wchodzą po resecie, zachowują identyfikatory i wygasają', async () => {
  assert.equal(supplementReviewedFacts(null, [], Date.parse('2026-09-03T08:00:00Z')).length, 0);
  const now = Date.parse('2026-09-17T09:35:00Z');
  const facts = supplementReviewedFacts(null, [], now);
  assert.equal(facts.length, 14);
  const first = await mergeFacts(null, facts, now);
  validateSnapshot(first);
  assert.equal(first.sections.find(s => s.id === 'free-vehicles').items.length, 5);
  assert.equal(first.sections.find(s => s.id === 'gun-van').items.length, 9);
  const second = await mergeFacts(first, supplementReviewedFacts(first, [], now + 60000), now + 60000);
  assert.deepEqual(JSON.parse(JSON.stringify(second.sections)), JSON.parse(JSON.stringify(first.sections)));
  const later = projectContent(second, Date.parse('2026-09-24T09:00:00Z'));
  assert.equal(later.sections.find(s => s.id === 'gun-van').items.length, 0);
  assert.equal(supplementReviewedFacts(null, [], Date.parse('2026-10-01T00:00:00Z')).length, 0);
});

test('świeższe fakty źródła mają pierwszeństwo przed uzupełnieniem', () => {
  const now = Date.parse('2026-09-17T10:00:00Z');
  const original = supplementReviewedFacts(null, [], now)[0];
  const correction = { ...original, offer: 'Corrected by current source' };
  const merged = supplementReviewedFacts(null, [correction], now);
  assert.equal(merged.length, 14);
  assert.equal(merged[0], correction);
});

test('naprawa źródeł zachowuje cytowanie obsługiwane przez aplikację', () => {
  const bad = { sources: [{url:'https://www.igrandtheftauto.com/gtaonline/news/this-week-in-gta-online-september-17-2026'}, {url:'https://rockstarintel.com/article'}] };
  const fixed = normalizeReviewedSources(bad);
  assert.deepEqual(fixed.sources, [{url:'https://rockstarintel.com/article'}]);
  assert.equal(bad.sources.length, 2);
});
