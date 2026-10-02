import test from 'node:test';
import assert from 'node:assert/strict';
import { articleDocument, agreeSources, mergeFacts } from '../scripts/facts.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';
const now=new Date('2026-10-02T12:00:00Z');
const make=(kind,vehicle='Lampadati Cinquemila',extra='')=>{
 const heading=kind==='intel'?'Podium Vehicle':'The Diamond Casino and Resort Lucky Wheel:';
 const body=kind==='intel'?`Spin the Lucky Wheel for a chance to win the ${vehicle}, which is on the podium.`:`${vehicle} (Sedan)`;
 const doc=articleDocument({kind,sourceUrl:kind==='intel'?'https://rockstarintel.com/test':'https://www.igrandtheftauto.com/gtaonline/news/this-week-in-gta-online-october-1-2026',html:`<meta property="article:published_time" content="2026-10-01"><article><h1>This Week in GTA Online: October 1, 2026</h1><p>October 1–7</p><h2>${heading}</h2><p>${body}</p>${extra}</article>`},now);
 const extracted=extractWeeklyRotations(doc);return {...doc,...extracted,current:true};
};
test('podium requires agreement on vehicle and weekly period and describes chance, not a guaranteed gift',()=>{
 const intel=make('intel'),igta=make('igta');
 assert.equal(intel.facts.length,1);assert.equal(igta.facts.length,1);
 const agreed=agreeSources([intel,igta],false);assert.equal(agreed.length,1);
 assert.match(agreed[0].offer,/chance to win.*winning is not guaranteed/);
 assert.equal(agreeSources([intel,make('igta','Grotti Itali RSX')],false).length,0);
 assert.equal(agreeSources([intel,{...igta,current:false}],false).length,0);
 assert.equal(agreeSources([intel,{...igta,facts:igta.facts.map(f=>({...f,offer:'FREE'}))}],false).length,0);
});
test('explicit regular and GTA+ percentage pair is scoped correctly; stock alone and El Strickler never establish discounts',()=>{
 const doc=make('intel','Lampadati Cinquemila','<h2>Gun Van Contents</h2><ul><li>Knife (10%, GTA+ 20%)</li><li>El Strickler (10%, GTA+ 20%)</li><li>Combat Shotgun</li></ul>');
 assert.ok(doc.facts.some(f=>f.entity==='Knife' && f.offer==='10% off at the Gun Van' && f.eligibility==='all'));
 assert.ok(doc.facts.some(f=>f.entity==='Knife' && f.offer==='20% off at the Gun Van' && f.eligibility==='gta-plus'));
 assert.ok(!doc.facts.some(f=>f.entity==='El Strickler'));
 assert.ok(!doc.facts.some(f=>f.entity==='Combat Shotgun' && /off/.test(f.offer)));
 const discounts=doc.facts.filter(f=>/off/.test(f.offer));
 assert.equal(agreeSources([{...doc,facts:discounts}],false).length,0);
 assert.equal(agreeSources([{...doc,facts:discounts},{...doc,source:{kind:'igta'},facts:discounts.map(f=>({...f,eligibility:f.eligibility==='all'?'gta-plus':'all'}))}],false).length,0);
});

test('a bare stock list preserves a confirmed active free offer and discount, then releases them in the next week',async()=>{
 const sample=make('intel','Lampadati Cinquemila','<h2>Gun Van Contents</h2><ul><li>Knife</li></ul>').facts.find(f=>f.entity==='Knife');
 for(const offer of ['FREE at the Gun Van','10% off at the Gun Van']) {
  const known={...sample,offer,confidence:'corroborated'};
  const first=await mergeFacts(null,[known],+now);const original=first.sections.find(s=>s.id==='gun-van').items[0];
  const second=await mergeFacts(first,[{...sample,confidence:'corroborated'}],+now+60000);
  assert.deepEqual(second.sections.find(s=>s.id==='gun-van').items,[original]);
  const next=await mergeFacts(second,[{...sample,confidence:'corroborated',startsOn:'2026-10-08',endsOn:'2026-10-14'}],Date.parse('2026-10-08T12:00:00Z'));
  assert.equal(next.sections.find(s=>s.id==='gun-van').items[0].offer,'In stock');
 }
});
