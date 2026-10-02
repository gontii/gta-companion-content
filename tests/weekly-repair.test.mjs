import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agreeSources, hash, mergeFacts, validateFacts, FACT_VALIDATION_VERSION } from '../scripts/facts.mjs';
import { publicEdition, createBundle } from '../scripts/publication-bundle.mjs';
import { inspectContentStatus } from '../scripts/content-health.mjs';
import { projectContent, atLocal } from '../scripts/temporal.mjs';
import { SourceService, AI_MODEL } from '../scripts/source-service.mjs';
import { extractRockstarFacts } from '../scripts/rockstar-facts.mjs';
import { PublicationEngine } from '../worker/coordinator.mjs';
const now=Date.parse('2026-10-01T12:00:00Z');
const f={ section:'bonuses',entity:'Contact Missions',offer:'2X GTA$ & RP',eligibility:'all',platform:'all',startsOn:'2026-10-01',endsOn:'2026-10-07',sources:[{kind:'intel',url:'https://rockstarintel.com/current'}],evidence:'Contact Missions pay 2X GTA$ & RP',dateEvidence:'October 1-7',confidence:'corroborated' };
const docs=(a,b)=>[{source:{kind:'intel'},facts:[a],current:true},{source:{kind:'gtabase'},facts:[b],current:true}];
class Storage {
  data=new Map(); async get(k){return structuredClone(this.data.get(k));} async put(k,v){this.data.set(k,structuredClone(v));} async delete(k){this.data.delete(k);} async list({prefix,limit}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).slice(0,limit));} async setAlarm(at){this.alarm=at;} async getAlarm(){return this.alarm;}
}
async function snapshot(facts=[f],time=now) {
  const c=projectContent(await mergeFacts(null,facts,time),time);
  c.generatedAt=new Date(time).toISOString(); c.revision=await hash(c); return c;
}
test('equivalent known reward units agree, conflicts and unknown prose fail closed',()=>{
  assert.equal(agreeSources(docs(f,{...f,offer:'2X GTA$ and RP'}),false).length,1);
  for(const change of [{offer:'3X GTA$ & RP'},{offer:'2X GTA$'},{platform:'enhanced'},{eligibility:'gta-plus'},{endsOn:'2026-10-08'},{offer:'2X GTA$ & RP on your first completion'},{offer:'2X GTA$ & RP for 3 consecutive days'}])assert.equal(agreeSources(docs(f,{...f,...change}),false).length,0);
  assert.equal(agreeSources(docs({...f,offer:'A new amazing reward'},{...f,offer:'A new amazing reward'}),false).length,0);
  const official={...f,offer:'GTA$100,000 for completing two bounties',sources:[{kind:'rockstar',url:'https://www.rockstargames.com/current'}]};
  assert.equal(agreeSources([{source:{kind:'rockstar'},facts:[official]},...docs(f,{...f,offer:'GTA$1,000,000 for completing two bounties'})],false)[0].offer,official.offer);
});
test('dated Rockstar blocks separate weekly discounts, monthly offers and future challenges',()=>{
  const text='Dispatch Work will earn you 2X GTA$ and RP all October long. Additional Discounts: October 1–7 Sea Sparrow (Helicopter) – 30% off October 8–14: Win in two Adversary modes to get the Pink Skull Emissive Mask and GTA$100,000';
  const html='<p>Dispatch Work will earn you 2X GTA$ and RP all October long.</p><h3>Additional Discounts: October 1–7</h3><p>Sea Sparrow (Helicopter) – 30% off</p><h2>Rewards</h2><p>October 8–14: Win in two Adversary modes to get the Pink Skull Emissive Mask and GTA$100,000</p>';
  const r=extractRockstarFacts({text,html,publishedOn:'2026-10-01',source:{kind:'rockstar',url:'https://www.rockstargames.com/test'}});
  assert.equal(r.facts.find(f=>f.entity==='Dispatch Work').endsOn,'2026-10-31');
  assert.equal(r.facts.find(f=>f.entity==='Sea Sparrow').endsOn,'2026-10-07');
  assert.equal(r.facts.find(f=>f.section==='challenge').startsOn,'2026-10-08');
  const invalid={...f,dateEvidence:'September 10–October 7'};
  assert.equal(validateFacts({facts:[invalid]},{text:invalid.evidence+' '+invalid.dateEvidence,source:f.sources[0]}).facts.length,0);
});
test('saved AI response is revalidated without spending another inference',async()=>{
  const storage=new Storage();const doc={text:f.evidence+' '+f.dateEvidence,publishedOn:'2026-10-01',period:{startId:f.startsOn,endId:f.endsOn},source:f.sources[0]};
  const key='ai-result:'+await hash([AI_MODEL,6,doc.source.url,doc.publishedOn,doc.period,doc.text]);
  await storage.put(key,{raw:{facts:[f]},cachedAt:now});
  const result=await new SourceService(storage,{AI:{run:()=>{throw Error('unexpected AI');}}},now).extract(doc);
  assert.equal(result.facts.length,1);
  const diagnostic=await storage.get('last-extraction:intel:weekly');assert.equal(diagnostic.source.url,doc.source.url);assert.equal(diagnostic.validationVersion,FACT_VALIDATION_VERSION);
});
test('week transition, ids, missing sources and independent GTA+ expiry',async()=>{
  const old={...f,startsOn:'2026-09-24',endsOn:'2026-09-30'};
  const c=await mergeFacts(null,[old],Date.parse('2026-09-25T12:00:00Z'));
  const next=await mergeFacts(c,[f],now);assert.equal(next.weekId,'2026-10-01');assert.equal(next.sections[0].items[0].id,c.sections[0].items[0].id);
  const again=await mergeFacts(next,[],now+60000);assert.equal(again.sections[0].items[0].id,next.sections[0].items[0].id);
  assert.equal(projectContent(c,now).sections[0].items.length,0);
  const member={...f,section:'gta-plus',eligibility:'gta-plus',startsOn:'2026-09-10',endsOn:'2026-10-07',sources:[{kind:'rockstar',scope:'membership',url:'https://www.rockstargames.com/member'}]};
  const both=await snapshot([f,member]);const view=projectContent(both,Date.parse('2026-10-07T22:00:00Z'));
  assert.equal(view.sections.find(s=>s.id==='gta-plus').items.length,0);assert.equal(view.sections[0].items.length,1);
});
test('2637 → 2638: delayed corroboration, partial extraction and the next run preserve an editorial correction',async()=>{
  const before=Date.parse('2026-09-16T12:00:00Z'), reset=Date.parse('2026-09-17T09:00:00Z');
  const old={...f,entity:'Old Prize Ride',section:'free-vehicles',offer:'FREE for winning four consecutive days',startsOn:'2026-09-10',endsOn:'2026-09-16'};
  const current={...f,entity:'Bunker Research',startsOn:'2026-09-17',endsOn:'2026-09-23'};
  const previous=await mergeFacts(null,[old],before);
  // A single current source and an empty delayed extraction cannot establish agreement.
  const single=[{source:{kind:'intel'},facts:[current],current:true},{source:{kind:'gtabase'},facts:[],current:false}];
  assert.equal(agreeSources(single,false).length,0);
  assert.equal(projectContent(previous,reset).sections.flatMap(s=>s.items).length,0);
  const agreed=agreeSources([...single.slice(0,1),{source:{kind:'gtabase'},facts:[{...current,sources:[{kind:'gtabase',url:'https://www.gtabase.com/current'}]}],current:true}],false);
  const next=await mergeFacts(previous,agreed,reset);
  assert.equal(next.weekId,'2026-09-17');
  assert.ok(!next.sections.flatMap(s=>s.items).some(i=>i.entity==='Old Prize Ride'));
  const correction=next.sections.find(s=>s.id==='bonuses').items[0];
  correction.editorial=true;
  correction.label='Bunker Research — 2X GTA$ & RP; reviewed correction';
  const expected=structuredClone(correction);
  const repeated=await mergeFacts(next,[{...current,offer:'3X GTA$ & RP'}],reset+15*60000);
  assert.deepEqual(repeated.sections.find(s=>s.id==='bonuses').items,[expected]);
  const partial=await mergeFacts(repeated,[],reset+30*60000);
  assert.deepEqual(partial.sections.find(s=>s.id==='bonuses').items,[expected]);
  const app=projectContent(partial,reset+30*60000);
  app.generatedAt=new Date(reset+30*60000).toISOString();app.revision=await hash(app);
  const bundle=await createBundle(app,null,reset+30*60000);
  assert.equal(bundle.issue,'2638');
  assert.equal(bundle.values[0].sections.flatMap(s=>s.items).find(i=>i.id===expected.id).offer,expected.label);
});
test('public version retains factual labels, ids and clocks and remains partial',async()=>{
  const app=await snapshot();const b=await createBundle(app,null,now);const [article,,page]=b.values;
  assert.equal(article.sections[0].items[0].id,app.sections[0].items[0].id);assert.equal(article.sections[0].items[0].offer,app.sections[0].items[0].label);
  assert.equal(article.expiresAt,app.expiresAt);assert.ok(article.sections.some(s=>s.items.some(i=>i.status==='pending')));
  const health=inspectContentStatus({app,page,article,receipt:{weekId:app.weekId,verifiedRevision:app.revision,verifiedAt:new Date(now).toISOString()}},now);
  assert.equal(health.current,true);assert.equal(health.alarm,false);
  page.current.sections[0].items[0].offer='3X GTA$';assert.equal(inspectContentStatus({app,page,article,receipt:{}},now).alarm,true);
  const safe=JSON.stringify(article);assert.ok(!safe.includes('dateEvidence'));assert.ok(!safe.includes('factKey'));
});
test('future edition stays preview, reset grace is 15 minutes and fresh generatedAt/GTA+ do not prove freshness',async()=>{
  const app=await snapshot();const before=atLocal('2026-10-01',650);const future={...app,generatedAt:new Date(before).toISOString()};
  assert.equal(publicEdition(future,before).status,'preview');
  const stale=await snapshot([{...f,startsOn:'2026-09-24',endsOn:'2026-09-30'}],Date.parse('2026-09-25T12:00:00Z'));
  stale.generatedAt=new Date(now).toISOString();
  assert.equal(inspectContentStatus({app:stale},atLocal('2026-10-01',674)).alarm,false);
  assert.equal(inspectContentStatus({app:stale},atLocal('2026-10-01',675)).alarm,true);
});
for(const failAt of [0,1,2])test(`bundle resumes a crash at write ${failAt} across object restart`,async t=>{
  t.mock.timers.enable({apis:['Date'],now:new Date(now)});
  t.mock.method(SourceService.prototype,'websites',async()=>({documents:[],failures:[],hasCurrentArticle:true}));
  const storage=new Storage();let failure=true;const kv=new Map(),writes=[];
  const env={PUBLICATION_MODE:'publish',CONTENT_KV:{get:async(k,type)=>type==='json'?kv.get(k):JSON.stringify(kv.get(k)),put:async(k,v)=>{if(failure&&writes.filter(k=>k!=='weekly:receipt').length===failAt){failure=false;throw Error('controlled-crash');}writes.push(k);kv.set(k,JSON.parse(v));}}};
  let engine=new PublicationEngine({storage},env);await engine.alarm();assert.equal((await storage.get('state')).lastError,'controlled-crash');
  const pending=await storage.get('pending-bundle');assert.equal(pending.step,failAt);
  engine=new PublicationEngine({storage},env);await engine.alarm();assert.equal((await storage.get('state')).lastError,null);
  assert.equal(kv.get('weekly:public').current.revision,kv.get('weekly:latest').revision);assert.equal(writes.filter(k=>k==='weekly:latest').length,1);
  assert.equal(await storage.get('pending-bundle'),undefined);
  // A delayed independent read cannot set verifiedRevision.
  t.mock.method(globalThis,'fetch',async()=>Response.json({app:{revision:'old'},public:{revision:'old'},article:{revision:'old'}}));
  t.mock.timers.tick(76000);await engine.alarm();assert.notEqual((await storage.get('state')).verifiedRevision,pending.revision);
});
test('a free property listed in two sections remains a single reward with its existing id',async()=>{
  const reward={...f,section:'free-vehicles',entity:'Grapeseed Bunker',offer:'FREE'};
  const a=await mergeFacts(null,[reward],now),id=a.sections.find(s=>s.id==='free-vehicles').items[0].id;
  const b=await mergeFacts(a,[reward,{...reward,section:'discounts',offer:'100% off'}],now);
  assert.equal(b.sections.find(s=>s.id==='free-vehicles').items[0].id,id);assert.equal(b.sections.find(s=>s.id==='discounts').items.length,0);
});
test('rollback restores the coordinator and both channels and holds automatic publication',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(now)});const storage=new Storage();const kv=new Map();
 const old=await snapshot([{...f,startsOn:'2026-09-24',endsOn:'2026-09-30'}],Date.parse('2026-09-25T12:00:00Z'));const current=await snapshot();
 const oldPage=(await createBundle(old,null,Date.parse(old.generatedAt))).values[2];
 await storage.put('publication',current);await storage.put('master',current);await storage.put('state',{publishedRevision:current.revision});
 await storage.put('previous-publication',old);await storage.put('previous-master',old);await storage.put('previous-public-page',oldPage);await storage.put('previous-coordinator-state',{publishedRevision:old.revision});await storage.put('previous-fact-keys',[]);
 const engine=new PublicationEngine({storage},{PUBLICATION_MODE:'publish',CONTENT_KV:{put:async(k,v)=>kv.set(k,JSON.parse(v))}});
 await assert.rejects(engine.rollback('wrong'),/revision_changed/);await engine.rollback(current.revision);assert.equal(kv.get('weekly:latest').revision,old.revision);assert.equal(kv.get('weekly:public').current.weekId,old.weekId);
 assert.equal((await storage.get('master')).revision,old.revision);await engine.alarm();assert.equal(kv.get('weekly:latest').revision,old.revision);assert.equal(await storage.get('publication-paused'),true);
});
test('a new membership period plus carryover monthly bonuses cannot turn freshness green',async()=>{
 const next=Date.parse('2026-10-08T12:00:00Z');
 const monthly={...f,startsOn:'2026-10-01',endsOn:'2026-10-31',windowPolicy:'independent'};
 const member={...f,section:'gta-plus',eligibility:'gta-plus',startsOn:'2026-10-08',endsOn:'2026-11-04'};
 const app=await snapshot([monthly,member],next);const [article,,page]=(await createBundle(app,null,next)).values;
 const h=inspectContentStatus({app,page,article,receipt:{weekId:app.weekId,verifiedRevision:app.revision,verifiedAt:new Date(next).toISOString()}},next);
 assert.equal(h.current,false);assert.equal(h.alarm,true);assert.ok(h.reasons.includes('app_week_not_current'));
});
