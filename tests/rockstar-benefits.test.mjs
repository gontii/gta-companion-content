import test from 'node:test';
import assert from 'node:assert/strict';
import { benefitLinks,benefitEnd,calendarPeriod,parseBenefitCards,resolveRockstarBenefits } from '../scripts/rockstar-benefits.mjs';
import { collectSectionEvidence,inspectSectionCoverage } from '../scripts/section-coverage.mjs';
import { mergeFacts,agreeSources } from '../scripts/facts.mjs';
import { atLocal,projectContent } from '../scripts/temporal.mjs';
const period={startId:'2026-11-05',endId:'2026-12-09',sourceUrl:'https://gta.wiki/w/GTA%2B_November_2026',evidence:'November 5, 2026 - December 9, 2026'};
const module=(id,title,text,tag='')=>({id,title:'GTA+57: '+title,visible:true,tina:{payload:{content:[{_template:'CardWithImageGallery',_memoq:{title},textOverlayProps:{_memoq:{tag}},content:[{_template:'HTMLElement',_memoq:{content:text}}]}]}}});
const free=module('abc12','Test Car','The Test Car is free to claim for GTA+ Members at The Vinewood Car Club.','Vehicle Benefits');
const contact=module('abc13','2X GTA$ and RP on Contact Missions','2X GTA$ and RP through December 9 (stacks to 4X between November 12 and December 2).');
test('monthly calendar needs explicit start and a matching official end; no upload-date inference',()=>{
 assert.deepEqual(calendarPeriod('|availability = November 5, [[2026]] - December 9, 2026','2026-12-09','2026-11-05',period.sourceUrl),period);
 assert.throws(()=>calendarPeriod('|availability = October 8, 2026 - November 4, 2026','2026-12-09','2026-11-05','url'),/mismatch/);
 assert.throws(()=>calendarPeriod('November 5','2026-12-09','2026-11-05','url'),/missing/);
});
test('membership boost has three independent windows, with 4X absent before November 12',async()=>{
 const parsed=parseBenefitCards([free,contact],period);assert.equal(parsed.facts.length,4);
 const facts=agreeSources([{source:{kind:'rockstar'},...parsed}],false);
 for(const [day,offer] of [['2026-11-05','2X GTA$ & RP'],['2026-11-12','4X GTA$ & RP'],['2026-12-03','2X GTA$ & RP']]) {
   const at=Date.parse(day+'T12:00Z'),snapshot=projectContent(await mergeFacts(null,facts,at),at);
   assert.equal(snapshot.sections.find(s=>s.id==='gta-plus').items.find(i=>i.entity==='Contact Missions').offer,offer);
 }
});
test('one parsed GTA+ benefit cannot mask an unrecognized monthly card',()=>{
 const parsed=parseBenefitCards([free,module('abc14','New benefit','Unknown new condition')],period);
 assert.deepEqual(parsed.coverageGaps,['gta-plus']);
 const at=atLocal('2026-11-05',720),item={label:'Test Car',startsAt:'2026-11-05T10:00Z',expiresAt:'2026-12-09T23:00Z'};
 const evidence=collectSectionEvidence([{current:true,period,source:{kind:'rockstar'},...parsed}],'2026-11-05','2026-11-05');
 const coverage=inspectSectionCoverage({weekId:'2026-11-05',sections:[{id:'gta-plus',items:[item]}]},evidence,at,'2026-11-05',atLocal('2026-11-05',660));
 assert.equal(coverage.areas.find(a=>a.id==='gta-plus').state,'unconfirmed');
});
test('source follows currently linked modules and cards, without hard-coded month ids or AI',async()=>{
 const meta={tina:{payload:{content:[{_template:'gen9.ClaimCountdown',_memoq:{left:'Claim these event benefits through',right:'December 9, 2026'}},{_template:'TinaModuleFetchNRender',id:'new12'}]}}};
 assert.equal(benefitEnd(meta),'2026-12-09');assert.deepEqual(benefitLinks(meta,'TinaModuleFetchNRender'),['new12']);
 const data=new Map(),calls=[];
 const doc=await resolveRockstarBenefits({get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)},Date.parse('2026-11-05T12:00Z'),async input=>{
   const u=new URL(input);calls.push(u.hostname);
   if(u.hostname==='gta.wiki') return new Response('|availability = November 5, [[2026]] - December 9, 2026');
   if(u.searchParams.get('operationName')==='MetaUrlInfo') return Response.json({data:{metaUrlInfo:meta}});
   const ids=JSON.parse(u.searchParams.get('variables')).ids;
   if(ids[0]==='new12') return Response.json({data:{tinaModulesInfo:[{tina:{payload:{content:[{_template:'Deck',cards:[{id:'abc12'}]}]}}}]}});
   assert.deepEqual(ids,['abc12']);return Response.json({data:{tinaModulesInfo:[free]}});
 });
 assert.equal(doc.facts[0].entity,'Test Car');assert.equal(doc.facts[0].eligibility,'gta-plus');
 assert.equal(doc.facts[0].platform,'enhanced');assert.equal(calls.length,4);
});
