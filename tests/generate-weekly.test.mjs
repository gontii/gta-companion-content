import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildWeeklyContent, generateWeeklyFiles, thursdayWeekId } from '../scripts/generate-weekly.mjs';

test('thursdayWeekId returns the current GTA Online Thursday', () => {
  assert.equal(thursdayWeekId(new Date('2026-06-23T12:00:00Z')), '2026-06-18');
  assert.equal(thursdayWeekId(new Date('2026-06-25T12:00:00Z')), '2026-06-25');
});

test('builds valid weekly content from the Rockstar fixture', async () => {
  const html = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
  const content = buildWeeklyContent(html, {
    now: new Date('2026-06-23T12:00:00Z'),
    sourceUrl: 'fixture://rockstar-weekly',
  });

  assert.equal(content.weekId, '2026-06-18');
  assert.equal(content.range, 'June 18 - 24, 2026');
  assert.equal(content.sections.length, 6);
  assert.equal(new Set(content.sections.map((section) => section.id)).size, 6);
  assert.ok(content.headline.includes('Fine Art Collector'));
  assert.ok(content.quickTake.length >= 3);
});

test('writes weekly/<weekId>.json and weekly/latest.json', async () => {
  const html = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-weekly-'));

  try {
    const result = await generateWeeklyFiles({
      html,
      outputDir: dir,
      now: new Date('2026-06-23T12:00:00Z'),
      sourceUrl: 'fixture://rockstar-weekly',
    });

    const weekly = JSON.parse(await readFile(path.join(dir, 'weekly/2026-06-18.json'), 'utf8'));
    const latest = JSON.parse(await readFile(path.join(dir, 'weekly/latest.json'), 'utf8'));
    assert.equal(result.weekId, '2026-06-18');
    assert.deepEqual(latest, weekly);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails closed when the source does not match the current week', () => {
  const oldHtml = '<article><h1>Old week</h1><meta name="article:published_time" content="2026-06-11T10:00:00Z"></article>';

  assert.throws(
    () => buildWeeklyContent(oldHtml, { now: new Date('2026-06-23T12:00:00Z') }),
    /not the current weekly update/i,
  );
});
