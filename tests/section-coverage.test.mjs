import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIRED_AREAS, collectSectionEvidence, inspectSectionCoverage, reportedSectionCoverage } from '../scripts/section-coverage.mjs';
import { inspectContentStatus } from '../scripts/content-health.mjs';
import { atLocal, projectContent } from '../scripts/temporal.mjs';
import { hash, mergeFacts } from '../scripts/facts.mjs';
import { createBundle } from '../scripts/publication-bundle.mjs';
import { PublicationEngine } from '../worker/coordinator.mjs';
import { SourceService } from '../scripts/source-service.mjs';
const week='2026-10-01', expected=atLocal(week,660), now=expected+30*60000;
const item=(label,extra={})=>({label,startsAt:new Date(expected).toISOString(),expiresAt:new Date(expected+7*86400000).toISOString(),...extra});
const app={weekId:week,revision:'rev',sections:[{id:'free-vehicles',items:[item('Vapid Dominator GTT — Prize Ride: Top 5 for three consecutive days')]},{id:'gun-van',items:[item('Knife — In stock')] }]};
const doc=(kind,text='',facts=[])=>({current:true,period:{startId:week,endId:'2026-10-07'},source:{kind,url:`https://${kind}.example/current`},text,facts});
test('missing vehicle rotation and unknown discounts are independent of populated categories',()=>{
 const evidence=collectSectionEvidence([doc('intel','',[{section:'gun-van',entity:'Knife',offer:'20% off',eligibility:'gta-plus',startsOn:week,endsOn:'2026-10-07'}])],week,week);
 const c=inspectSectionCoverage(app,evidence,now,week,expected);
 const state=id=>c.areas.find(a=>a.id===id).state;
 assert.equal(state('prize-ride'),'confirmed');assert.equal(state('podium'),'missing');
 assert.equal(state('gun-van-stock'),'confirmed');assert.equal(state('gun-van-gta-plus'),'unconfirmed');
 assert.equal(state('gun-van-discounts'),'missing');assert.equal(c.alarm,true);
 assert.equal(inspectSectionCoverage(app,evidence,expected+14*60000,week,expected).alarm,false);
 assert.equal(inspectSectionCoverage(app,evidence,expected+15*60000,week,expected).alarm,true);
});
test('absence needs explicit current-period proof and official or anchor corroboration; omissions and extras never establish it',()=>{
 const inspect=docs=>inspectSectionCoverage(app,collectSectionEvidence(docs,week,week),now,week,expected).areas.find(a=>a.id==='podium').state;
 assert.equal(inspect([]),'missing');assert.equal(inspect([doc('intel','No podium vehicle this week')]),'unconfirmed');
 assert.equal(inspect([doc('igta','No podium vehicle this week'),doc('gtaboss','No podium vehicle this week')]),'unconfirmed');
 assert.equal(inspect([doc('intel','No podium vehicle this week'),doc('igta','No podium vehicle this week')]),'absent');
 assert.equal(inspect([doc('rockstar','No podium vehicle this week')]),'absent');
 assert.equal(inspect([{...doc('rockstar','No podium vehicle this week'),current:false}]),'missing');
 assert.equal(inspect([{...doc('rockstar','No podium vehicle this week'),period:{startId:'2026-09-24',endId:'2026-09-30'}}]),'missing');
 const conflicting=structuredClone(app);conflicting.sections[0].items.push(item('Cinquemila — Podium vehicle: chance to win at the Lucky Wheel'));
 assert.equal(inspectSectionCoverage(conflicting,collectSectionEvidence([doc('rockstar','No podium vehicle this week')],week,week),now,week,expected).areas.find(a=>a.id==='podium').state,'unconfirmed');
});
test('expired, future, placeholder and previous-week rows cannot prove current coverage',()=>{
 const invalid={...app,sections:[{id:'free-vehicles',items:[item('Podium vehicle',{expiresAt:new Date(expected).toISOString()}),item('Prize Ride',{startsAt:new Date(now+60000).toISOString()}),{label:'Podium vehicle pending'}]}]};
 assert.equal(inspectSectionCoverage(invalid,null,now,week,expected).resolvedAreas,0);
 const old=inspectSectionCoverage({...app,weekId:'2026-09-24'},null,now,week,expected);
 assert.equal(old.resolvedAreas,0);assert.deepEqual(old.sections,[]);
 const future=collectSectionEvidence([doc('intel','',[{section:'free-vehicles',entity:'Podium',startsOn:'2026-10-08',endsOn:'2026-10-14'}])],week,week);
 assert.equal(future.candidates.podium,0);
});
test('receipt rejects wrong revision, week, age, future timestamp, duplicated areas and inconsistent empty confirmations',()=>{
 const c=inspectSectionCoverage(app,null,now,week,expected);c.revision=app.revision;
 const receipt={weekId:week,sectionCoverage:c};
 assert.equal(reportedSectionCoverage(app,receipt,now,week,expected).receiptCurrent,true);
 for(const change of [{revision:'wrong'},{weekId:'2026-09-24'},{checkedAt:new Date(now-46*60000).toISOString()},{checkedAt:new Date(now+1).toISOString()},{areas:[...c.areas,c.areas[0]]},{areas:c.areas.map(a=>a.id==='podium'?{...a,state:'confirmed'}:a)}]) {
  assert.equal(reportedSectionCoverage(app,{...receipt,sectionCoverage:{...c,...change}},now,week,expected).receiptCurrent,false);
 }
});
test('current synchronized publication can separately alarm about incomplete sections',async()=>{
 const fact={section:'bonuses',entity:'Contact Missions',offer:'2X GTA$ & RP',eligibility:'all',platform:'all',startsOn:week,endsOn:'2026-10-07',sources:[{kind:'intel',url:'https://rockstarintel.com/current'}],confidence:'corroborated'};
 const snapshot=projectContent(await mergeFacts(null,[fact],now),now);snapshot.generatedAt=new Date(now).toISOString();snapshot.revision=await hash(snapshot);
 const [article,,page]=(await createBundle(snapshot,null,now)).values;
 const receipt={weekId:week,verifiedRevision:snapshot.revision,verifiedAt:new Date(now).toISOString()};
 const status=inspectContentStatus({app:snapshot,page,article,receipt},now);
 assert.equal(status.current,true);assert.equal(status.alarm,false);assert.equal(status.completenessAlarm,true);assert.ok(status.sectionCoverage.unresolved.includes('podium'));
});
test('natural engine run stores coverage in receipt and creates a separate incident without migration or forced source request',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date(now)});
 t.mock.method(SourceService.prototype,'websites',async()=>({documents:[],failures:[],hasCurrentArticle:true}));
 const data=new Map(),kv=new Map();
 const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k),list:async({prefix,limit})=>new Map([...data].filter(([k])=>k.startsWith(prefix)).slice(0,limit)),setAlarm:async at=>data.set('alarm',at)};
 const env={PUBLICATION_MODE:'publish',CONTENT_KV:{get:async k=>kv.get(k),put:async(k,v)=>kv.set(k,JSON.parse(v))}};
 await new PublicationEngine({storage},env).alarm();
 const state=data.get('state');assert.equal(state.lastError,null);
 assert.ok(state.incidents.some(i=>i.key==='section-completeness'));
 assert.equal(kv.get('weekly:receipt').sectionCoverage.requiredAreas,REQUIRED_AREAS.length);
 assert.equal(data.get('alarm')>now,true);
});
