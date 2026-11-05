import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { articleDocument, agreeSources } from '../scripts/facts.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';
import { findIgtaWeekly } from '../scripts/additional-sources.mjs';
import { parseWeeklyContent } from '../schemas/app-weekly-parser.mjs';
import { atLocal } from '../scripts/temporal.mjs';
import { createBundle } from '../scripts/publication-bundle.mjs';
import { hash } from '../scripts/facts.mjs';

const weeks = JSON.parse(await readFile(new URL('./fixtures/igta-week-structures.html.json', import.meta.url), 'utf8'));

const page = (weekId, body) => {
  const meta = weeks.weeks[weekId];
  return `<meta property="article:published_time" content="${meta.published}"><article><h1>${meta.title}</h1>${body}</article>`;
};
const parsed = (weekId, body, kind = 'igta') => {
  const meta = weeks.weeks[weekId];
  const doc = articleDocument({ kind, sourceUrl: kind === 'intel' ? 'https://rockstarintel.com/current' : meta.source, html: page(weekId, body) }, new Date(`${weekId}T12:00:00Z`));
  return { ...doc, ...extractWeeklyRotations(doc), current: true };
};
const offer = (doc, entity, includes) => doc.facts.find(f => f.entity === entity && (!includes || f.offer.includes(includes)));

test('iGTA discovery accepts ordinals and a trailing slash, and keeps the newest Thursday', () => {
  const older = '/gtaonline/news/this-week-in-gta-online-september-17-2026/';
  const newer = '/gtaonline/news/this-week-in-gta-online-october-29th-2026';
  const index = `<a href="${older}">old</a><a href="https://evil.example${newer}">off-origin</a><a href="${newer}?utm=1">query</a><a href="${newer}">new</a>`;
  assert.equal(findIgtaWeekly(index), 'https://www.igrandtheftauto.com' + newer);
  assert.equal(findIgtaWeekly('<a href="https://www.igrandtheftauto.com.evil.example' + newer + '">bad</a>'), null);
});

test('17.09 iGTA wording still yields podium, prize ride, discounts and both Gun Van prices', () => {
  const doc = parsed('2026-09-17', `
    <h2>Bonuses and Rewards</h2>
    <ul><li>2X GTA$ and RP on Ammu-Nation Contract Missions</li>
    <li>2X GTA$, RP, and Research Progress on Bunker Research Missions via Agent 14</li></ul>
    <h3>Premium Deluxe Motorsport Showroom – All 30% Off</h3>
    <ul><li>Ocelot XA-21 (Super)</li><li>Pegassi Torero (Sports Classic)</li></ul>
    <h3>The Diamond Casino and Resort Lucky Wheel</h3>
    <ul><li>Vapid Dominator ASP (Muscle)</li></ul>
    <h3>LS Car Meet Prize Ride</h3>
    <p>Win in the LS Car Meet Series for four days in a row to receive the Dinka LSCM Jester RR (Sports).</p>
    <h2>Gun Van Inventory</h2>
    <ul><li>Stun Gun – 40% off</li><li>Tactical SMG – 30% off for GTA+ Members</li><li>Heavy Sniper</li></ul>`);
  assert.equal(doc.period.startId, '2026-09-17');
  assert.equal(doc.period.endId, '2026-09-23');
  assert.ok(offer(doc, 'Vapid Dominator ASP', 'Podium'));
  assert.match(offer(doc, 'Dinka LSCM Jester RR').offer, /Prize Ride: win in the LS Car Meet Series for four days/);
  assert.ok(offer(doc, 'Ocelot XA-21', '30% off'));
  assert.ok(offer(doc, 'Stun Gun', '40% off'));
  assert.ok(offer(doc, 'Tactical SMG', '30% off') && offer(doc, 'Tactical SMG', '30% off').eligibility === 'gta-plus');
  assert.ok(offer(doc, 'Bunker Research Missions via Agent 14', '2X GTA$ & RP'));
  assert.ok(!doc.facts.some(f => f.entity === 'Heavy Sniper' && /off|FREE/.test(f.offer)));
});

test('08.10 percent-first Gun Van lines and the combined casino heading still agree with Intel', () => {
  const igta = parsed('2026-10-08', `
    <h2>Casino Podium and Prize Ride</h2>
    <p>Head to the Casino for a chance to win the Annis Savestra from the Lucky Wheel.</p>
    <p>Meanwhile, placing in the Top 4 in the LS Car Meet Series for two days in a row will unlock the Declasse Walton L35 as this week's Prize Ride.</p>
    <h2>Halloween Discounts</h2><ul><li>40% off – Albany Brigham</li></ul>
    <h2>Gun Van Inventory</h2>
    <ul><li>Free – The Shocker</li><li>30% off – Service Carbine</li><li>50% off for GTA+ Members – Widowmaker</li><li>El Strickler</li></ul>`);
  const intel = parsed('2026-10-08', `
    <p>October 8–14</p>
    <h3>Podium Vehicle</h3><p>Lucky Wheel for your chance to win the Annis Savestra, which costs money.</p>
    <h3>Prize Ride Challenge</h3><p>place top 4 in a LS Car Meet Race for 2 days in a row to unlock the Declasse Walton L35 as the Prize Ride vehicle.</p>
    <h3>Discounts:</h3><h5>40% off</h5><ul><li>Albany Brigham</li></ul>
    <h3>Gun Van Contents</h3><ul><li>The Shocker (FREE)</li><li>Service Carbine (30%, GTA+ 30%)</li><li>Widowmaker (10%, GTA+ 50%)</li><li>El Strickler (10%, GTA+ 20%)</li></ul>`, 'intel');
  const agreed = agreeSources([intel, igta], false);
  for (const [entity, offerText] of [['Annis Savestra', 'Podium'], ['Declasse Walton L35', 'top 4'], ['Albany Brigham', '40% off'], ['Service Carbine', '30% off'], ['Widowmaker', '50% off'], ['The Shocker', 'FREE']]) {
    assert.ok(agreed.some(f => f.entity === entity && f.offer.includes(offerText)), entity);
  }
  assert.ok(!agreed.some(f => f.entity === 'El Strickler'));
  assert.ok(agreed.find(f => f.entity === 'Widowmaker' && f.offer.includes('50%')).eligibility === 'gta-plus');
});

test('22.10 and 29.10 name-first lists, ampersand podium headings and Place in the Top still parse', () => {
  for (const [weekId, vehicle, rank, podium] of [
    ['2026-10-22', 'Grotti Itali Classic', '2', 'Pfister Comet S2'],
    ['2026-10-29', 'Karin Previon', '5', 'Progen GP1'],
  ]) {
    const doc = parsed(weekId, `
      <h2>Halloween Bonuses</h2>
      <ul><li>3X GTA$ and RP on Halloween Featured Series:<ul><li>Slasher</li></ul></li>
      <li>2X GTA$ on Ghosts Exposed (4X for GTA+ Members)</li></ul>
      <h2>Halloween Discounts – 40% Off</h2>
      <ul><li>Agency Properties – 40% off</li><li>Albany Brigham (Muscle) – 40% off</li></ul>
      <h2>Additional Vehicle Discounts – 30% Off</h2>
      <ul><li>Pfister Astron (SUV) – 30% off</li></ul>
      <h3>Luxury Autos Showroom</h3><ul><li>Dewbauchee Rapid GT X (Sports)</li></ul>
      <h3>The Diamond Casino &amp; Resort Lucky Wheel</h3><ul><li>${podium} (Super)</li></ul>
      <h3>LS Car Meet Prize Ride</h3>
      <p>Place in the Top ${rank} in the LS Car Meet Series for two days in a row to win the ${vehicle} (Sports Classic).</p>
      <h2>Gun Van Inventory</h2>
      <ul><li>The Shocker – Free</li><li>Service Carbine – 30% off</li>
      <li>Widowmaker – 50% off for GTA+ Members</li><li>Precision Rifle</li><li>El Strickler</li></ul>
      <h2>Showroom Vehicles</h2><ul><li>Unrelated Vehicle</li></ul>`);
    assert.equal(doc.period.startId, weekId);
    assert.ok(offer(doc, podium, 'Podium'), podium);
    assert.match(offer(doc, vehicle).offer, new RegExp(`Place top ${rank} .* two days`));
    assert.ok(offer(doc, 'Agency Properties', '40% off'));
    assert.ok(offer(doc, 'Albany Brigham', '40% off'));
    assert.ok(offer(doc, 'Pfister Astron', '30% off'));
    assert.ok(!offer(doc, 'Dewbauchee Rapid GT X', '30% off'));
    assert.ok(offer(doc, 'The Shocker', 'FREE'));
    assert.equal(offer(doc, 'Service Carbine', '30% off').eligibility, 'all');
    assert.equal(offer(doc, 'Widowmaker', '50% off').eligibility, 'gta-plus');
    assert.ok(offer(doc, 'Halloween Featured Series', '3X'));
    assert.equal(offer(doc, 'Ghosts Exposed', '2X').eligibility, 'all');
    assert.equal(offer(doc, 'Ghosts Exposed', '4X').eligibility, 'gta-plus');
    assert.ok(!doc.facts.some(f => f.entity === 'Unrelated Vehicle' || f.entity === 'El Strickler' || f.entity === 'Slasher'));
  }
});


test('November wording and accented podium names agree without weakening rewards or membership', () => {
  const date = '<p>November 5-11, 2026</p>';
  const makeDoc = (kind, html) => {
    const doc = articleDocument({kind, sourceUrl:kind==='intel'?'https://rockstarintel.com/current':'https://www.igrandtheftauto.com/current', html:date+html},new Date('2026-11-05T12:00:00Z'));
    return {...doc,...extractWeeklyRotations(doc),current:true};
  };
  const intel=makeDoc('intel', `<h3>Podium Vehicle</h3><p>Spin the lucky wheel for your chance to win the Överflöd Entity XXR, which costs money.</p>
    <h3>Prize Ride Challenge</h3><p>place top 5 in a LS Car Meet Race for 3 days in a row to unlock the Annis Hellion as the Prize Ride vehicle.</p>
    <h3>Weekly Challenge</h3><p>The GTA Online Weekly Challenge for this week is "Win an Adversary Mode". You'll earn GTA$100,000.</p>
    <h3>Gun Van Contents</h3><ul><li>Knife (FREE)</li><li>Widowmaker (10%, GTA+ 20%)</li></ul>
    <h3>Discounts:</h3><h5>30% off</h5><ul><li>Cheval Taipan</li></ul>`);
  const igta=makeDoc('igta', `<h3>Diamond Casino Lucky Wheel</h3><p>This week's podium vehicle at The Diamond Casino &amp; Resort is the Överflöd Entity XXR (Super), which players have a chance to win by spinning the Lucky Wheel.</p>
    <h2>Weekly Challenge and LS Car Meet Prize Ride</h2><ul><li>Weekly Challenge: Win any Adversary Mode to receive GTA$100,000.</li>
    <li>LS Car Meet Prize Ride: Finish in the Top 5 of an LS Car Meet Series race for three consecutive days to win the Annis Hellion (Off-Road).</li></ul>
    <h2>Gun Van Inventory and Discounts</h2><ul><li>Knife: Free.</li><li>Widowmaker: 30% off for GTA+ Members.</li></ul>
    <h2>Vehicle Offers and Discounts</h2><p>Additional vehicles at 30% off:</p><ul><li>Cheval Taipan (Super)</li></ul>
    <h3>Luxury Autos Showroom</h3><ul><li>Unconfirmed Car (Super)</li></ul>`);
  const agreed=agreeSources([intel,igta],false);
  for (const name of ['Överflöd Entity XXR','Annis Hellion','Adversary Mode','Knife','Cheval Taipan']) assert.ok(agreed.some(f=>f.entity===name),name);
  assert.ok(!agreed.some(f=>f.entity==='Widowmaker' && f.eligibility==='gta-plus'));
  assert.ok(!igta.facts.some(f=>f.entity==='Unconfirmed Car'));
  assert.equal(agreeSources([intel,{...igta,facts:igta.facts.map(f=>f.entity==='Annis Hellion'?{...f,offer:f.offer.replace('top 5','top 4')}:f)}],false).some(f=>f.entity==='Annis Hellion'),false);
});

test('official deterministic facts survive unavailable AI and do not borrow unrelated dates', async () => {
  const {SourceService}=await import('../scripts/source-service.mjs');
  const data=new Map(),storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)};
  const resolve=async()=>({sourceUrl:'https://www.rockstargames.com/newswire/article/test',html:'<meta property="article:published_time" content="2026-11-05"><h1>Weekly event</h1><p>November 5-11.</p><p>Play GTA Online anytime through November 11 to get The Great Circle Back.</p><p>Play GTA Online anytime through December 2 to get Future Gift.</p>'});
  const result=await new SourceService(storage,{},Date.parse('2026-11-05T12:00:00Z')).websites([['rockstar',resolve,'weekly']]);
  assert.equal(result.documents[0].facts.length,1);
  assert.equal(result.documents[0].facts[0].entity,'The Great Circle Back');
  assert.equal(result.documents[0].facts[0].endsOn,'2026-11-11');
  assert.equal(result.failures[0].reason,'ai_binding_missing');
});
