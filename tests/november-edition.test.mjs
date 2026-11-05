import test from 'node:test';
import assert from 'node:assert/strict';
import { articleDocument, mergeFacts, agreeSources } from '../scripts/facts.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';
import { supplementReviewedFacts } from '../scripts/reviewed-weekly.mjs';
import { projectContent } from '../scripts/temporal.mjs';

test('GTABase and iGTA corroborate Gun Van discounts without an AI response',()=>{
 const make=(kind,body)=>{
   const doc=articleDocument({kind,sourceUrl:`https://${kind}.example/week`,html:`<meta property="article:published_time" content="2026-11-05"><article><h1>November 5–11, 2026</h1>${body}</article>`},new Date('2026-11-05'));
   return {...doc,current:true,...extractWeeklyRotations(doc)};
 };
 const base=make('gtabase','<h3>GUN VAN Primary Discounts</h3><ul><li>50% Off: Precision Rifle</li><li>40% Off GTA+: Compact EMP Launcher</li><li>80% Off GTA+: Armor</li></ul>');
 const igta=make('igta','<h2>Gun Van Inventory and Discounts</h2><ul><li>Precision Rifle: 50% off.</li><li>Compact EMP Launcher: 40% off for GTA+ Members.</li><li>Armor: 80% off for GTA+ Members.</li></ul>');
 const facts=agreeSources([base,igta],false).filter(f=>/% off/.test(f.offer));
 assert.equal(facts.length,3);
 assert.equal(facts.find(f=>f.entity==='Precision Rifle').eligibility,'all');
 assert.equal(facts.find(f=>f.entity==='Compact EMP Launcher').eligibility,'gta-plus');
});

test('reviewed November offers retain first-completion conditions and expire at their actual boundary',async()=>{
 const at=Date.parse('2026-11-05T20:00Z');
 const master=await mergeFacts(null,supplementReviewedFacts(null,[],at),at);
 const items=master.sections.flatMap(s=>s.items);
 assert.match(items.find(i=>i.entity==='Original Heists').offer,/first-time completion/);
 assert.ok(!/RP/.test(items.find(i=>i.entity==='Original Heists').offer));
 assert.match(items.find(i=>i.entity==='The Cayo Perico Heist').offer,/first approach/);
 const first=items.find(i=>i.entity==='Precision Rifle');
 const again=await mergeFacts(master,supplementReviewedFacts(master,[],at+60000),at+60000);
 assert.equal(again.sections.flatMap(s=>s.items).find(i=>i.entity==='Precision Rifle').id,first.id);
 assert.ok(!projectContent(master,Date.parse('2026-11-12T10:00Z')).sections.flatMap(s=>s.items).some(i=>i.entity==='Precision Rifle'));
});
