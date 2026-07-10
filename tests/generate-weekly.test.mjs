import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildWeeklyContent,
  findRockstarNewswirePost,
  findWeeklySourceUrl,
  generateFirstValidWeeklyFiles,
  generateWeeklyFiles,
  rockstarPostToHtml,
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

test('uses a mid-week source publication date as the weekly id', async () => {
  const html = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
  const midWeekHtml = html.replace(
    'content="2026-06-18T10:00:00Z"',
    'content="2026-07-01T10:00:00Z"',
  );
  const content = buildWeeklyContent(midWeekHtml, {
    now: new Date('2026-07-02T12:00:00Z'),
    sourceUrl: 'fixture://rockstar-mid-week',
  });

  assert.equal(content.weekId, '2026-07-01');
  assert.equal(content.range, 'July 1 - 7, 2026');
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

test('uses the first valid source candidate when the primary source is stale', async () => {
  const html = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
  const staleHtml = html.replace(
    'content="2026-06-18T10:00:00Z"',
    'content="2026-06-01T10:00:00Z"',
  );
  const currentHtml = html.replace(
    'content="2026-06-18T10:00:00Z"',
    'content="2026-07-01T10:00:00Z"',
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-weekly-candidates-'));

  try {
    const result = await generateFirstValidWeeklyFiles(
      [
        { sourceUrl: 'fixture://rockstar-stale', html: staleHtml },
        { sourceUrl: 'fixture://gtabase-current', html: currentHtml },
      ],
      { outputDir: dir, now: new Date('2026-07-02T12:00:00Z') },
    );

    assert.equal(result.weekId, '2026-07-01');
    assert.equal(result.sourceUrl, 'fixture://gtabase-current');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keeps generated weekly files unchanged when only generatedAt would change', async () => {
  const html = await readFile(new URL('./fixtures/rockstar-weekly.html', import.meta.url), 'utf8');
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-weekly-stable-'));

  try {
    await generateWeeklyFiles({
      html,
      outputDir: dir,
      now: new Date('2026-06-23T12:00:00Z'),
      sourceUrl: 'fixture://rockstar-weekly',
    });
    const first = await readFile(path.join(dir, 'weekly/latest.json'), 'utf8');

    await generateWeeklyFiles({
      html,
      outputDir: dir,
      now: new Date('2026-06-24T12:00:00Z'),
      sourceUrl: 'fixture://rockstar-weekly',
    });
    const second = await readFile(path.join(dir, 'weekly/latest.json'), 'utf8');

    assert.equal(second, first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fails closed when the source does not match the current week', () => {
  const oldHtml = '<article><h1>Old week</h1><meta name="article:published_time" content="2026-06-11T10:00:00Z"></article>';

  assert.throws(
    () => buildWeeklyContent(oldHtml, { now: new Date('2026-06-23T12:00:00Z') }),
    /not recent enough/i,
  );
});

test('finds the latest GTA Online post from the Rockstar Newswire list', () => {
  const posts = [
    {
      id: 'vi',
      url: '/newswire/article/vi/pre-order-grand-theft-auto-vi',
      title: 'Pre-Order Grand Theft Auto VI',
      primary_tags: [{ id: 666, name: 'Grand Theft Auto VI' }],
    },
    {
      id: 'gtao',
      url: '/newswire/article/gtao/earn-special-rewards-in-gta-online',
      title: 'Earn Special Rewards in GTA Online',
      primary_tags: [{ id: 702, name: 'GTA Online' }],
    },
  ];

  assert.deepEqual(findRockstarNewswirePost(posts), posts[1]);
});

test('turns Rockstar Tina payload content into parseable article HTML', () => {
  const html = rockstarPostToHtml(
    {
      title: 'Official GTA Online Update',
      created: '7/1/26, 10:00 AM',
      tina: {
        payload: {
          meta: { blurb: 'Official blurb.' },
          variables: {
            keys: {
              one: { title: 'Best bonuses' },
              two: { content: '<p><strong>2X GTA$</strong> on Casino Work.</p>' },
            },
          },
        },
      },
    },
    'https://www.rockstargames.com/newswire/article/test',
  );

  assert.match(html, /article:published_time/);
  assert.match(html, /Official GTA Online Update/);
  assert.match(html, /Best bonuses/);
  assert.match(html, /2X GTA\$/);
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

test('allows a current weekly source to omit a weekly challenge section', () => {
  const html = `
    <html>
      <head><meta property="article:published_time" content="2026-07-01T08:39:29+00:00"></head>
      <body>
        <h1>GTA Online Weekly Update (July 1 - 13): Independence Day Bonuses</h1>
        <h2>Independence Day Rewards</h2>
        <ul>
          <li>Log in to receive the Lady Liberty Bucket Hat</li>
          <li>Complete any Business Battle to receive GTA$200,000</li>
        </ul>
        <h2>This Week's Bonuses &amp; Discounts</h2>
        <ul class="fields-container">
          <li class="field-entry gta5-bonuses full-width">
            <h3>GTA$ &amp; RP Bonuses</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <h3 class="contentheading noindex"><a title="Independence Day Land Races">Independence Day Land Races</a></h3>
                <div class="bonus-multiplier rp">3x</div>
                <div class="bonus-multiplier cash">3x</div>
              </li>
            </ul>
          </li>
          <li class="field-entry gta5-discounts full-width">
            <h3>In-Game Discounts</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <h3 class="contentheading noindex"><a title="Firework Launcher">Firework Launcher</a></h3>
                <span class="badge new">-50%</span>
              </li>
            </ul>
          </li>
          <li class="field-entry showrooms-test-rides full-width">
            <h3>Showrooms &amp; Test Rides</h3>
            <ul>
              <li class="gta-bonuses item-scale">
                <div class="item-type"><span class="podium-vehicle">Podium Vehicle</span></div>
                <h3 class="contentheading noindex"><a title="Vapid Dominator GTX">Vapid Dominator GTX</a></h3>
              </li>
            </ul>
          </li>
        </ul>
        <h3>Salvage Yard Robberies</h3>
        <ul><li><strong>The Duggan Robbery</strong>: Coquette BlackFin</li></ul>
        <h3>Premium Race &amp; Trials</h3>
        <ul><li><strong>Premium Race</strong>: Down the Drain</li></ul>
        <h3>GUN VAN Primary Discounts</h3>
        <ul><li><strong>FREE</strong>: Firework Launcher</li></ul>
      </body>
    </html>
  `;

  const content = buildWeeklyContent(html, { now: new Date('2026-07-02T12:00:00Z') });
  assert.equal(content.weekId, '2026-07-01');
  assert.deepEqual(content.sections.find((section) => section.id === 'challenge').items, []);
  assert.ok(content.quickTake.length >= 3);
  assert.ok(content.locations.length >= 3);
});

// Minimal but schema-valid weekly article (h2/ul markup) with a chosen publish
// date and headline, for exercising date-range parsing.
function weeklyHtml(publish, headline) {
  return `<html>
    <head><meta name="article:published_time" content="${publish}"></head>
    <body>
      <h1>${headline}</h1>
      <h2>Best bonuses</h2>
      <ul><li>3X GTA$ and RP on the Stunt Race Series</li><li>2X GTA$ and RP on Bunker Sell Missions</li></ul>
      <h2>Weekly Challenge</h2>
      <ul><li>Complete any Heist Finale for a GTA$1,000,000 bonus</li></ul>
      <h2>Free rewards and prize vehicles</h2>
      <ul><li>Claim the free Lago Zancudo Bunker</li><li>Log in for the Lady Liberty Bucket Hat</li></ul>
      <h2>Discounts</h2>
      <ul><li>Mobile Operations Center 70% off</li></ul>
      <h2>Gun Van</h2>
      <ul><li>Free Firework Launcher</li></ul>
      <h2>Other weekly items</h2>
      <ul><li>Premium Race: Muscle In</li></ul>
    </body>
  </html>`;
}

test('reads a non-standard (sub-week) date range straight from the source', () => {
  const content = buildWeeklyContent(
    weeklyHtml('2026-07-09T10:00:00Z', 'GTA Online Weekly Update (July 9 - 13): Independence Day Finale'),
    { now: new Date('2026-07-09T12:00:00Z') },
  );
  assert.equal(content.weekId, '2026-07-09');
  assert.equal(content.range, 'July 9 - 13, 2026');
});

test('parses a cross-month date range', () => {
  const content = buildWeeklyContent(
    weeklyHtml('2026-07-30T10:00:00Z', 'GTA Online Weekly Update (July 30 - August 5): Summer Bonuses'),
    { now: new Date('2026-07-30T12:00:00Z') },
  );
  assert.equal(content.weekId, '2026-07-30');
  assert.equal(content.range, 'July 30 - August 5, 2026');
});

test('falls back to the 7-day range when the source states no range', () => {
  const content = buildWeeklyContent(
    weeklyHtml('2026-07-09T10:00:00Z', 'GTA Online Weekly Update: Independence Day Finale'),
    { now: new Date('2026-07-09T12:00:00Z') },
  );
  assert.equal(content.weekId, '2026-07-09');
  assert.equal(content.range, 'July 9 - 15, 2026');
});

test('rejects a recently-published article that describes an old period', () => {
  // Publish date is current (passes the age gate) but the stated period is a
  // week old — the drift guard must still fail closed.
  assert.throws(
    () =>
      buildWeeklyContent(
        weeklyHtml('2026-07-09T10:00:00Z', 'GTA Online Weekly Update (July 1 - 7): Last Week'),
        { now: new Date('2026-07-09T12:00:00Z') },
      ),
    /too far from the current GTA week/i,
  );
});

test('refuses to overwrite a newer published week with an older one', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-weekly-regress-'));
  try {
    await generateWeeklyFiles({
      html: weeklyHtml('2026-07-09T10:00:00Z', 'GTA Online Weekly Update (July 9 - 13): Finale'),
      outputDir: dir,
      now: new Date('2026-07-09T12:00:00Z'),
      sourceUrl: 'fixture://july-9',
    });

    await assert.rejects(
      generateWeeklyFiles({
        html: weeklyHtml('2026-07-02T10:00:00Z', 'GTA Online Weekly Update (July 2 - 8): Independence Day'),
        outputDir: dir,
        now: new Date('2026-07-02T12:00:00Z'),
        sourceUrl: 'fixture://july-2',
      }),
      /Refusing to overwrite newer published week/i,
    );

    const latest = JSON.parse(await readFile(path.join(dir, 'weekly/latest.json'), 'utf8'));
    assert.equal(latest.weekId, '2026-07-09');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
