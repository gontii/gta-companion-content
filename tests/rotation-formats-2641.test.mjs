import test from 'node:test';
import assert from 'node:assert/strict';
import { articleDocument, agreeSources } from '../scripts/facts.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';

const doc = (kind, body) => {
  const article = articleDocument({ kind, sourceUrl: `https://example.com/${kind}`,
    html: `<meta property="article:published_time" content="2026-10-07"><article><h1>This Week in GTA Online: October 8, 2026</h1><p>October 8–14</p>${body}</article>` }, new Date('2026-10-09T12:00:00Z'));
  return { ...article, ...extractWeeklyRotations(article), current: true };
};
test('combined casino heading and placing wording agree with the dated Intel rotations', () => {
  const intel = doc('intel', '<h3>Podium Vehicle</h3><p>Lucky Wheel for your chance to win the Annis Savestra, which costs money.</p><h3>Prize Ride Challenge</h3><p>place top 4 in a LS Car Meet Race for 2 days in a row to unlock the Declasse Walton L35 as the Prize Ride vehicle.</p>');
  const igta = doc('igta', '<h2>Casino Podium and Prize Ride</h2><p>Head to the Casino for a chance to win the <strong>Annis Savestra</strong> from the Lucky Wheel.</p><p>Meanwhile, placing in the <strong>Top 4 in the LS Car Meet Series for two days in a row</strong> will unlock the <strong>Declasse Walton L35</strong> as this week\'s Prize Ride.</p>');
  const approved = agreeSources([intel, igta], false);
  assert.equal(approved.filter(f => f.section === 'free-vehicles').length, 2);
  assert.match(approved.find(f => f.entity === 'Declasse Walton L35').offer, /top 4.*2 days in a row/);
  assert.equal(agreeSources([intel, doc('igta', '<h2>Casino Podium and Prize Ride</h2><p>A chance to win the Annis Savestra from the Lucky Wheel.</p><p>placing in the Top 3 in the LS Car Meet Series for two days in a row will unlock the Declasse Walton L35 as this week\'s Prize Ride.</p>')], false).filter(f => f.entity === 'Declasse Walton L35').length, 0);
});
test('explicit member Gun Van discounts corroborate across list formats without becoming public discounts', () => {
  const intel = doc('intel', '<h3>Gun Van Contents</h3><ul><li>Widowmaker (10%, GTA+ 50%)</li></ul>');
  const igta = doc('igta', '<h2>Gun Van Inventory</h2><ul><li><strong>50% off for GTA+ Members</strong> – Widowmaker</li></ul>');
  const approved = agreeSources([intel, igta], false);
  assert.ok(approved.some(f => f.entity === 'Widowmaker' && f.eligibility === 'gta-plus' && f.offer === '50% off at the Gun Van'));
  assert.ok(!approved.some(f => /off/.test(f.offer) && f.eligibility === 'all'));
});
test('discount heading groups corroborate inline and paragraph groups without AI paraphrases', () => {
  const intel = doc('intel', '<h3>Discounts:</h3><h5>40% off</h5><ul><li>Albany Brigham</li></ul><h5>30% off</h5><ul><li>BF Club</li></ul><h3>Bonuses</h3>');
  const igta = doc('igta', '<h2>Halloween Discounts</h2><ul><li><strong>40% off</strong> – Albany Brigham</li></ul><h2>Additional Vehicle Discounts</h2><p>Vehicles available at <strong>30% off</strong> this week:</p><ul><li>BF Club</li></ul><h2>Showroom Vehicles</h2><ul><li>Unrelated Vehicle</li></ul>');
  const approved = agreeSources([intel, igta], false).filter(f => f.section === 'discounts');
  assert.deepEqual(approved.map(f => [f.entity, f.offer]), [['Albany Brigham', '40% off'], ['BF Club', '30% off']]);
  assert.ok(!igta.facts.some(f => f.entity === 'Unrelated Vehicle'));
});
test('dated official apparel is extracted from its login-reward list, not an expired fan-site date', async () => {
  const { extractRockstarFacts } = await import('../scripts/rockstar-facts.mjs');
  const official = articleDocument({ kind: 'rockstar', sourceUrl: 'https://www.rockstargames.com/newswire/article/test',
    html: '<meta property="article:published_time" content="2026-10-01"><article><p>Playing GTA Online throughout the month will treat you to free items:</p><ul><li><p>October 8–14: Twilight Knife T-Shirt</p></li></ul></article>' }, new Date('2026-10-09T12:00:00Z'));
  const facts = extractRockstarFacts(official).facts;
  assert.ok(facts.some(f => f.entity === 'Twilight Knife T-Shirt' && f.section === 'free-vehicles' && f.startsOn === '2026-10-08' && f.endsOn === '2026-10-14'));
});
