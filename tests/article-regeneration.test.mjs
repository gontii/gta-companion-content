import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from './fixtures/article-2641.json' with { type: 'json' };
import { hash } from '../scripts/facts.mjs';
import { createBundle } from '../scripts/publication-bundle.mjs';

test('artykuł zachowuje pełny harmonogram Halloween, osobne Payphone Hits i warunki dostępu', async () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const app = structuredClone(fixture);
  app.generatedAt = new Date(now).toISOString();
  app.revision = await hash(app);
  const { values: [article, publishedApp, page] } = await createBundle(app, null, now);
  const items = article.sections.flatMap(s => s.items).filter(i => i.status === 'confirmed');
  const halloween = items.find(i => /Halloween Weekly Challenges Completion Bonus/.test(i.offer));
  for (const week of app.seasonalCashEvent.weeks) {
    for (const detail of [week.startsOn, week.endsOn, week.challenge, week.reward, week.outfit]) assert.ok(halloween.requirements.includes(detail), detail);
  }
  assert.match(halloween.requirements, /Payphone Hits is separate/);
  assert.match(items.find(i => /Payphone Hits/.test(i.name)).offer, /five Payphone Hits.*500,000.*72 hours/);
  assert.equal(items.find(i => /Win two Adversary Modes/.test(i.offer)).name, 'Adversary Modes');
  assert.match(items.find(i => i.name === 'Halloween Survivals').requirements, /Pause Menu.*Survivals/);
  assert.deepEqual(items.map(i => i.id).sort(), publishedApp.sections.filter(s => s.id !== 'dlc').flatMap(s => s.items).map(i => i.id).sort());
  assert.deepEqual(page.current, article);
  assert.ok(article.sections.flatMap(s => s.items).some(i => i.status === 'pending'));
});
