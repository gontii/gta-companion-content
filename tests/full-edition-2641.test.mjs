import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementReviewedFacts } from '../scripts/reviewed-weekly.mjs';
import { mergeFacts, agreeSources, articleDocument } from '../scripts/facts.mjs';
import { publicEdition } from '../scripts/publication-bundle.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';

const now = Date.parse('2026-10-10T10:00:00Z');
test('pełne wydanie zachowuje okres GTA+ i uzupełnia konkretne bonusy oraz nagrody', async () => {
  const c = await mergeFacts(null, supplementReviewedFacts(null, [], now), now);
  const section = id => c.sections.find(s => s.id === id).items;
  for (const name of ['Halloween Featured Series', 'Halloween Survivals', 'San Andreas Super Sport Series', 'Community Race Series', "Jack O' Lanterns", 'Ghosts Exposed', 'UFO Business Battles']) {
    assert.ok(section('bonuses').some(i => i.entity === name), name);
  }
  assert.ok(section('challenge').some(i => /five Payphone Hits.*500,000.*72 hours/.test(i.label)));
  const members = section('gta-plus');
  assert.ok(members.length >= 10);
  assert.ok(members.some(i => /Oppressor.*Skulls/.test(i.label)));
  assert.ok(members.some(i => /Brickade.*Manchez Scout C/.test(i.label)));
  assert.ok(members.every(i => i.eligibility === 'gta-plus' && i.platform === 'enhanced'));
  assert.equal(members.find(i => i.entity === 'Pegassi Oppressor').expiresAt, '2026-11-04T23:00:00.000Z');
  assert.ok(!members.some(i => /MC Businesses|Nagasaki Chimera/.test(i.label)), 'nie kopiuj błędnej listy z artykułu fanowskiego');
});

test('potwierdzony rabat Gun Van jest silniejszy od samej dostępności', () => {
  const f = { section:'gun-van',entity:'Service Carbine',eligibility:'all',platform:'all',startsOn:'2026-10-08',endsOn:'2026-10-14',offer:'In stock',sources:[{url:'https://rockstarintel.com/week',kind:'intel'}] };
  const docs = ['intel','igta'].map(kind => ({source:{kind},current:true,facts:[f,{...f,offer:'30% off at the Gun Van'}]}));
  assert.equal(agreeSources(docs, false).find(i => i.entity === 'Service Carbine').offer, '30% off at the Gun Van');
});

test('lista premii oddziela GTA+ i GTA$ bez dopisywania RP', () => {
  const doc = articleDocument({kind:'igta',sourceUrl:'https://www.igrandtheftauto.com/week',html:'<meta name="article:published_time" content="2026-10-07"><article><h1>This Week in GTA Online: October 8, 2026</h1><h2>Bonuses</h2><ul><li>3X GTA$ and RP – Community Race Series</li><li>2X GTA$ – Ghosts Exposed, increased to 4X for GTA+ Members</li></ul></article>'},new Date(now));
  const {facts}=extractWeeklyRotations(doc);
  assert.ok(facts.some(f=>f.entity==='Community Race Series' && f.offer==='3X GTA$ & RP'));
  assert.ok(facts.some(f=>f.entity==='Ghosts Exposed' && f.eligibility==='all' && f.offer==='2X GTA$'));
  assert.ok(facts.some(f=>f.entity==='Ghosts Exposed' && f.eligibility==='gta-plus' && f.offer==='4X GTA$'));
});

test('korekta widocznego tekstu zachowuje identyfikator istniejącego wyzwania', async () => {
  const f={section:'challenge',entity:'in two Adversary modes',offer:'Win in two Adversary modes to receive the Pink Skull Emissive Mask and GTA$100,000.',eligibility:'all',platform:'all',startsOn:'2026-10-08',endsOn:'2026-10-14',confidence:'official',sources:[{kind:'rockstar',url:'https://www.rockstargames.com/newswire/article/test'}]};
  const first=await mergeFacts(null,[f],now);
  const id=first.sections.find(s=>s.id==='challenge').items[0].id;
  const second=await mergeFacts(first,[f],now);
  const item=second.sections.find(s=>s.id==='challenge').items[0];
  assert.equal(item.id,id);
  assert.match(item.label,/^Adversary Modes — Week 2\/5: Win two Adversary Modes/);
});
