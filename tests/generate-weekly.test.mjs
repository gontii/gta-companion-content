import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildWeeklyContent,
  findWeeklySourceUrl,
  generateWeeklyFiles,
  thursdayWeekId,
} from '../scripts/generate-weekly.mjs';

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

test('finds the latest GTA Online weekly update URL from the GTABase index', () => {
  const html = `
    <main>
      <a href="/articles/grand-theft-auto-v/news/gta-online-discounts">Other GTA Online News</a>
      <a href="/articles/grand-theft-auto-v/news/gta-online-weekly-update-june-25-july-1-fine-art-collector-program-continues-bonuses-discounts">
        GTA Online Weekly Update (June 25 - July 1): Fine Art Collector Program Continues, Bonuses & Discounts
      </a>
    </main>
  `;

  assert.equal(
    findWeeklySourceUrl(html),
    'https://www.gtabase.com/articles/grand-theft-auto-v/news/gta-online-weekly-update-june-25-july-1-fine-art-collector-program-continues-bonuses-discounts',
  );
});

test('returns null when the source index has no weekly update link', () => {
  assert.equal(findWeeklySourceUrl('<a href="/news">Newswire</a>'), null);
});

test('builds valid weekly content from GTABase field-entry markup', () => {
  const html = `
    <html>
      <head><meta property="article:published_time" content="2026-06-25T08:39:29+00:00"></head>
      <body>
        <h1>GTA Online Weekly Update (June 25 - July 1): Fine Art Collector Program Continues</h1>
        <h2>Fine Art Collector Program</h2>
        <ul>
          <li>Log in to receive <strong>GTA$500,000</strong> within 72 hours</li>
          <li>Complete any Heist to receive <strong>GTA$1,000,000</strong></li>
        </ul>
        <h2>Weekly Challenge</h2>
        <p>Complete 3 FIB Files to receive <strong>GTA$100,000</strong></p>
        <h2>This Week's Bonuses &amp; Discounts</h2>
        <ul class="fields-container">
          <li class="field-entry gta5-bonuses full-width">
            <h3>GTA$ &amp; RP Bonuses</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <h3 class="contentheading noindex"><a title="Acid Product Missions">Acid Product Missions</a></h3>
                <div class="bonus-multiplier rp">2x</div>
                <div class="bonus-multiplier cash">2x</div>
              </li>
            </ul>
          </li>
          <li class="field-entry gta5-discounts full-width">
            <h3>In-Game Discounts</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <h3 class="contentheading noindex"><a title="Brickade 6x6 (Acid Lab)">Brickade 6x6 (Acid Lab)</a></h3>
                <span class="badge new">-40%</span>
              </li>
            </ul>
          </li>
          <li class="field-entry showrooms-test-rides full-width">
            <h3>Showrooms &amp; Test Rides</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <div class="item-type"><span class="podium-vehicle">Podium Vehicle</span></div>
                <h3 class="contentheading noindex"><a title="Coquette D10">Coquette D10</a></h3>
              </li>
              <li class="gta-bonuses item-scale">
                <div class="item-type"><span class="test-ride">Test Ride</span></div>
                <h3 class="contentheading noindex"><a title="XLS">XLS</a></h3>
              </li>
            </ul>
          </li>
        </ul>
        <h3>GTA$ &amp; RP also on</h3>
        <ul><li><strong>4X GTA$</strong> on FIB Priority File</li></ul>
        <h3>Salvage Yard Robberies</h3>
        <ul><li><strong>The Gangbanger Robbery</strong>: Tigon (Top Tier)</li></ul>
        <h3>Premium Race &amp; Trials</h3>
        <ul><li><strong>Premium Race</strong>: Senora Freeway</li></ul>
        <h3>GUN VAN Primary Discounts</h3>
        <ul><li><strong>FREE</strong>: Baseball Bat</li></ul>
      </body>
    </html>
  `;

  const content = buildWeeklyContent(html, { now: new Date('2026-06-26T12:00:00Z') });
  assert.equal(content.weekId, '2026-06-25');
  assert.equal(content.sections.length, 6);
  assert.ok(content.sections.find((section) => section.id === 'bonuses').items.some((item) => item.label.includes('Acid')));
  assert.ok(content.sections.find((section) => section.id === 'discounts').items.some((item) => item.label.includes('40% off')));
});
