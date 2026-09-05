import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applySeasonalContent, septemberEvent, isSeasonalEvent } from '../scripts/seasonal-content.mjs';
import { generateWeeklyFiles, writeCuratedWeekly, validateContent } from '../scripts/generate-weekly.mjs';

const current = JSON.parse(await readFile(new URL('../weekly/2026-09-03.json', import.meta.url)));
const oldBanner = 'NEW DLC: The Kortz Center Heist is live — plan the art heist from a Mansion Art Studio';

for (const [day, index] of [['2026-09-03',0],['2026-09-09',0],['2026-09-10',1],['2026-09-17',2],['2026-09-24',3],['2026-09-30',3]]) {
  test(`curates challenge for ${day} without duplicate tasks`, () => {
    const input = { ...current, weekId: septemberEvent.weeks[index].startsOn, quickTake: [oldBanner, ...current.quickTake] };
    const now = new Date(`${day}T12:00:00Z`);
    const value = applySeasonalContent(input, now);
    const items = value.sections.find(s => s.id === 'challenge').items;
    assert.equal(items.length, 1);
    assert.ok(items[0].label.includes('extra GTA$1,000,000'));
    assert.ok(items[0].label.includes(septemberEvent.weeks[index].challenge));
    assert.equal(items[0].targetCount, index === 2 ? 3 : undefined);
    if (index === 0) assert.equal(items[0].id, 'the-gta-online-weekly-challenge-for-this-week-is');
    assert.ok(!value.quickTake.some(s => s.startsWith('NEW DLC:')));
    assert.deepEqual(applySeasonalContent(value, now), value);
    validateContent(value);
  });
}

test('omits event before launch, after expiry and for unrelated weeks', () => {
  for (const day of ['2026-09-02', '2026-10-01']) {
    assert.equal(applySeasonalContent({ ...current, seasonalEvent: septemberEvent }, new Date(`${day}T00:00:00Z`)).seasonalEvent, undefined);
  }
  assert.equal(applySeasonalContent({ ...current, weekId: '2026-08-27' }, new Date('2026-09-05')).seasonalEvent, undefined);
});

test('validates seasonal schedule and old weekly payloads', () => {
  assert.ok(isSeasonalEvent(septemberEvent));
  for (const change of [v => v.weeks[0].endsOn = '2026-02-30', v => v.sourceUrl = 'javascript:alert(1)', v => v.weeks[1].startsOn = v.weeks[0].startsOn, v => v.vehicleReward.claimUntil = '2026-10-10', v => v.weeks[2].targetCount = 0]) {
    const invalid = structuredClone(septemberEvent); change(invalid);
    assert.equal(isSeasonalEvent(invalid), false);
    assert.throws(() => validateContent({ ...current, seasonalEvent: invalid }), /seasonalEvent/);
  }
  const old = structuredClone(current); delete old.seasonalEvent;
  validateContent(old);
});

test('curates richer retained content, writes both files and preserves generatedAt on rerun', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-seasonal-'));
  try {
    await mkdir(path.join(dir, 'weekly'));
    const rich = { ...current, quickTake: [oldBanner, ...current.quickTake] };
    rich.sections.find(s => s.id === 'other').items.push(...Array.from({ length: 100 }, (_, i) => ({ id: `extra-${i}`, label: `Preserved offer ${i}` })));
    await writeFile(path.join(dir, 'weekly/latest.json'), JSON.stringify(rich));
    const fixture = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
    const html = fixture.replaceAll('2026-06-18', '2026-09-03').replaceAll('June 18', 'September 3').replaceAll('June 24', 'September 9');
    const first = await generateWeeklyFiles({ html, outputDir: dir, now: new Date('2026-09-05T10:00:00Z') });
    assert.equal(first.preservedExisting, true);
    assert.ok(first.content.sections.find(s => s.id === 'other').items.some(i => i.id === 'extra-99'));
    assert.equal(first.content.seasonalEvent.id, septemberEvent.id);
    assert.ok(!first.content.quickTake.includes(oldBanner));
    const second = await writeCuratedWeekly(first.content, dir, new Date('2026-09-05T11:00:00Z'));
    assert.equal(second.content.generatedAt, first.content.generatedAt);
    assert.equal(await readFile(path.join(dir, 'weekly/latest.json'), 'utf8'), await readFile(path.join(dir, 'weekly/2026-09-03.json'), 'utf8'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
