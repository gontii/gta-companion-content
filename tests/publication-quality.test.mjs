import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildWeeklyContent, generateWeeklyFiles, generateFirstValidWeeklyFiles, validateContent } from '../scripts/generate-weekly.mjs';
import { applySeasonalContent } from '../scripts/seasonal-content.mjs';
import { applyMemberBenefits, requireMemberPeriod, validatePublication, assertPublishedContent, PublicationQualityError, validateMemberPeriods, memberPeriods } from '../scripts/publication-quality.mjs';
const now = new Date('2026-09-06T12:00:00Z');
const html = await readFile(new URL('./fixtures/rockstarintel-september-03.html', import.meta.url), 'utf8');
const parse = source => buildWeeklyContent(source, { now });
const curated = () => applyMemberBenefits(applySeasonalContent(parse(html), now), now);
const section = (content, id) => content.sections.find(s => s.id === id);

test('September Discounts: retains all 18 offers across heading levels and punctuation', () => {
  for (const heading of ['Discounts:', 'Discounts', 'Discounts：', 'Discounts —']) {
    for (const level of ['h4', 'h5', 'h6']) {
      const content = parse(html.replace('Discounts:', heading).replaceAll('h5', level));
      assert.equal(section(content, 'discounts').items.length, 18);
      assert.equal(section(content, 'discounts').items[0].label, 'Arcadius Business Center Executive Office - Free');
      assert.match(section(content, 'discounts').items[1].label, /70% off/);
      assert.equal(section(content, 'discounts').items.filter(i => /30% off/.test(i.label)).length, 16);
    }
  }
});

test('unparseable or partially lost advertised discounts fail closed', () => {
  for (const source of [html.replace('<h5>FREE<br><div></div></h5>', ''), html.replace('70% off', 'Huge savings'), html.replaceAll(/<h5>.*?<\/h5>/g, '')]) {
    assert.throws(() => parse(source), PublicationQualityError);
  }
  assert.throws(() => parse(html.replace('Discounts:', 'Special Discounts:')), /Unmapped weekly section/);
});

test('retains showroom second sentences, business clothing and dated heist details', () => {
  const content = parse(html);
  const other = section(content, 'other').items.map(i => i.label).join('\n');
  assert.match(other, /Benefactor LRC GT.*Pfister X-treme/);
  assert.match(other, /Coil Cyclone.*Dewbauchee Vagner.*Grotti Cheetah.*Karin 190z.*Överflöd Entity XF/);
  assert.match(other, /primary targets: Consumato, Stacks Study V, Trust/);
  assert.match(other, /without dying.*400,000/);
  assert.match(section(content, 'free-vehicles').items.map(i => i.label).join('\n'), /Business Battle.*Six Figure Tee/);
});

test('membership merge is idempotent, distinct from free public office and dated', () => {
  const content = curated();
  validateContent(content);
  validatePublication(content, now);
  assert.equal(section(content, 'gta-plus').items.length, 9);
  assert.ok(section(content, 'gta-plus').items.every(i => /^GTA\+ only:/.test(i.label) && i.label.includes('2026-09-09')));
  assert.match(section(content, 'gta-plus').items[0].label, /60% off Darnell Bros Garment Factory/);
  assert.match(section(content, 'discounts').items[0].label, /FREE for all players.*no GTA\+ required/);
  assert.match(content.quickTake[0], /FREE Arcadius/);
  assert.equal(section(content, 'discounts').items[0].id, 'arcadius-business-center-executive-office-free');
  assert.deepEqual(applyMemberBenefits(content, now), content);
  assert.ok(!JSON.stringify(section(content, 'gta-plus')).includes('6X'));
});

test('membership expires at its own boundary and does not leak to unrelated weeks', () => {
  const content = curated();
  for (const day of ['2026-08-12', '2026-09-10']) {
    const date = new Date(`${day}T00:00:00Z`);
    assert.equal(section(applyMemberBenefits(content, date), 'gta-plus'), undefined);
    assert.throws(() => requireMemberPeriod(date), /No verified GTA\+ benefits/);
  }
  for (const day of ['2026-08-13', '2026-09-09']) requireMemberPeriod(new Date(day));
  assert.equal(section(applyMemberBenefits({ ...content, weekId: '2026-09-10' }, now), 'gta-plus'), undefined);
});

test('publication rejects empty sections, missing individual offers and missing membership', () => {
  for (const id of ['bonuses', 'discounts', 'gta-plus']) {
    const content = curated(); section(content, id).items = [];
    assert.throws(() => validatePublication(content, now), /Publication/);
  }
  for (let index = 0; index < 18; index++) {
    const content = curated(); section(content, 'discounts').items.splice(index, 1);
    assert.throws(() => validatePublication(content, now), /Publication missing/);
  }
});

test('smoke compares entire live artifact, including changes invisible to counts', () => {
  const expected = curated();
  assert.doesNotThrow(() => assertPublishedContent(structuredClone(expected), expected, now));
  const actual = structuredClone(expected); actual.headline += ' wrong';
  assert.throws(() => assertPublishedContent(actual, expected, now), /differs/);
});

test('a large old payload with empty discounts cannot suppress recovered offers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-discounts-'));
  try {
    await mkdir(path.join(dir, 'weekly'));
    const broken = curated(); section(broken, 'discounts').items = [];
    section(broken, 'other').items.push(...Array.from({ length: 100 }, (_, n) => ({id: `extra-${n}`, label: `Extra ${n}`})));
    await writeFile(path.join(dir, 'weekly/latest.json'), JSON.stringify(broken));
    const result = await generateWeeklyFiles({ html, outputDir: dir, now });
    assert.equal(result.preservedExisting, false);
    assert.equal(section(result.content, 'discounts').items.length, 18);
    validatePublication(result.content, now);
    const before = await readFile(path.join(dir, 'weekly/latest.json'), 'utf8');
    await assert.rejects(generateFirstValidWeeklyFiles([{html: html.replace('70% off', 'Huge savings')}], {outputDir:dir, now}), PublicationQualityError);
    assert.equal(await readFile(path.join(dir, 'weekly/latest.json'), 'utf8'), before);
  } finally { await rm(dir, {recursive:true, force:true}); }
});


test('rejects malformed or overlapping monthly source records', () => {
  for (const change of [p => p[0].endsOn = '2026-02-30', p => p[0].sourceUrl = 'https://example.com',
    p => p[0].items = [], p => p[0].items.push(p[0].items[0]), p => p.push(p[0])]) {
    const value = structuredClone(memberPeriods); change(value);
    assert.throws(() => validateMemberPeriods(value), PublicationQualityError);
  }
});

test('membership item counts cannot freeze same-week source corrections', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'gta-updates-'));
  try {
    await generateWeeklyFiles({html, outputDir:dir, now});
    const changed = html.replace('4x GTA$ &amp; RP on Special Vehicle Work', '4x GTA$ &amp; RP on Special Vehicle Work — updated entry point');
    assert.notEqual(changed, html);
    const result = await generateWeeklyFiles({html:changed, outputDir:dir, now});
    assert.equal(result.preservedExisting, false);
    assert.match(section(result.content, 'bonuses').items[0].label, /updated entry point/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
