import test from 'node:test';
import assert from 'node:assert/strict';
import { articleDocument, agreeSources, mergeFacts, hash, validateFacts } from '../scripts/facts.mjs';
import { findIgtaWeekly, findRedditWeekly, resolveIgtaSource, resolveGtaBossSource } from '../scripts/additional-sources.mjs';
import { SourceService, WEBSITE_SOURCES } from '../scripts/source-service.mjs';
import { extractWeeklyRotations } from '../scripts/weekly-rotations.mjs';
import { createBundle } from '../scripts/publication-bundle.mjs';
import { parseWeeklyContent } from '../schemas/app-weekly-parser.mjs';
const at = Date.parse('2026-10-02T12:00:00Z');
const html = (date='October 1, 2026',pub='2026-09-30') => `<meta property="article:published_time" content="${pub}"><article><h1>This Week in GTA Online: ${date}</h1><p>Place Top 5 in the LS Car Meet Series for three days in a row to win the Vapid Dominator GTT (Muscle).</p><h2>Gun Van Inventory</h2><p>Knife Combat Shotgun Precision Rifle Pipe Bombs El Strickler</p><h2>Rotating Content</h2></article>`;
const doc = (kind, value=html()) => articleDocument({kind,sourceUrl:kind==='intel'?'https://rockstarintel.com/current':'https://www.igrandtheftauto.com/gtaonline/news/this-week-in-gta-online-october-1-2026',html:value},new Date(at));
test('recurring discovery selects only fixed-origin weekly articles, not GTA VI or lookalike hosts',async()=>{
 const path='/gtaonline/news/this-week-in-gta-online-october-8-2026';
 const index=`<a href="https://evil.invalid${path}">bad</a><a href="${path}">weekly</a>`;
 assert.equal(findIgtaWeekly(index),'https://www.igrandtheftauto.com'+path);
 assert.equal(findIgtaWeekly('<a href="https://www.igrandtheftauto.com.evil.invalid'+path+'">bad</a>'),null);
 const calls=[];const result=await resolveIgtaSource(async url=>{calls.push(url);return Response.json({});}).catch(e=>e);
 assert.match(result.message,/weekly_missing/);
 const source=await resolveIgtaSource(async url=>{calls.push(url);return new Response(url.endsWith('/news')?index:html('October 8, 2026','2026-10-07'));});
 const next=articleDocument({...source,kind:'igta'},new Date('2026-10-08T12:00:00Z'));
 assert.deepEqual([next.period.startId,next.period.endId],['2026-10-08','2026-10-14']);
 assert.equal(extractWeeklyRotations(next).facts.length,5);
 assert.equal((await resolveGtaBossSource(async()=>new Response('weekly'))).sourceUrl,'https://www.gtaboss.gg/gta-5-online/gta-online-weekly-updates');
});
test('named weekly date differs from publication date; a non-Thursday or missing title supplies no inferred period',()=>{
 const d=doc('igta');assert.equal(d.publishedOn,'2026-09-30');assert.equal(d.period.startId,'2026-10-01');
 assert.equal(doc('igta',html('October 2, 2026')).period,null);
 const r=extractWeeklyRotations(d);assert.equal(r.facts.length,5);assert.ok(!r.facts.some(f=>f.entity==='El Strickler'));
 assert.ok(!extractWeeklyRotations(doc('igta',html().replace('Gun Van Inventory','Other inventory'))).facts.some(f=>f.section==='gun-van'));
});
test('community RSS selects weekly post body and actual publication, without replies or arbitrary links',()=>{
 const entry=`<entry><title>Weekly Bonuses and Discounts - October 1st to October 8th</title><link href="https://www.reddit.com/r/gtaonline/comments/abcde/weekly/"/><published>2026-09-30T20:00:00Z</published><content type="html">&lt;p&gt;Knife&lt;/p&gt;</content></entry>`;
 const r=findRedditWeekly(entry);assert.ok(r.html.includes('Knife'));assert.ok(r.html.includes('2026-09-30T20:00:00Z'));
 assert.equal(findRedditWeekly(entry.replace('www.reddit.com','evil.invalid')),null);
 assert.equal(findRedditWeekly(entry.replace('2026-09-30T20:00:00Z','unknown')),null);
});
test('extra sources confirm an anchor; copied extras, stale sources and conflicting conditions do not form a quorum',()=>{
 const ig=doc('igta'),facts=extractWeeklyRotations(ig).facts;
 const anchored={...ig,source:{kind:'intel'},facts:facts.map(f=>({...f,sources:[{kind:'intel',url:'https://rockstarintel.com/current'}]})),current:true};
 const extra={...ig,facts,current:true};
 assert.equal(agreeSources([anchored,extra],false).length,5);
 assert.equal(agreeSources([extra,{...extra,source:{kind:'gtaboss'}}],false).length,0);
 assert.equal(agreeSources([anchored,{...extra,current:false}],false).length,0);
 for(const offer of ['Place Top 4 in the LS Car Meet Series for three days in a row to win the Vapid Dominator GTT','Place Top 5 in the LS Car Meet Series for four days in a row to win the Vapid Dominator GTT','Win the Vapid Dominator GTT']){
  const changed={...extra,facts:[{...facts[0],offer}]};assert.equal(agreeSources([{...anchored,facts:[anchored.facts[0]]},changed],false).length,0);
 }
 const override={...facts[0],offer:'Official requirement',sources:[{kind:'rockstar',url:'https://www.rockstargames.com/current'}]};
 assert.equal(agreeSources([{source:{kind:'rockstar'},facts:[override]},anchored,extra],false)[0].offer,'Official requirement');
});
test('source price contradicting its percentage fails grounding rather than supplying a currency value',()=>{
 const evidence='Knife −10% $400 $360 −20% $316';
 const f={section:'gun-van',entity:'Knife',offer:'20% off',eligibility:'gta-plus',platform:'all',startsOn:'2026-10-01',endsOn:'2026-10-07',evidence:evidence+' GTA+',dateEvidence:'October 1-7'};
 const d={source:{kind:'gtaboss'},text:f.evidence+' '+f.dateEvidence};
 assert.equal(validateFacts({facts:[f]},d).rejected[0].reason,'inconsistent_source_prices');
});
test('public citations keep corroborators, app publication remains readable by installed clients with identical ids and offers',async()=>{
 const ig=doc('igta'),facts=extractWeeklyRotations(ig).facts.map(f=>({...f,confidence:'corroborated',sources:[{kind:'intel',url:'https://rockstarintel.com/current'},...f.sources]}));
 const c=await mergeFacts(null,facts,at);c.generatedAt=new Date(at).toISOString();c.revision=await hash(c);
 const bundle=await createBundle(c,null,at);const [article,app]=bundle.values;
 assert.ok(parseWeeklyContent(app));assert.ok(article.sources.some(s=>s.title==='IGrandTheftAuto'));
 assert.ok(!app.sources.some(s=>s.kind==='igta'));assert.ok(c.sources.some(s=>s.kind==='igta'));
 assert.deepEqual(app.sections.flatMap(s=>s.items.map(i=>[i.id,i.label])),c.sections.flatMap(s=>s.items.map(i=>[i.id,i.label])));
 assert.equal((await createBundle(c,null,at)).writes[1].digest,bundle.writes[1].digest);
});
test('regular source service fetches extras even with official sections; no extra AI calls and stale editions yield no offers',async()=>{
 const data=new Map();const storage={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)};
 const service=new SourceService(storage,{},at);let calls=0;
 const sources=await service.websites([['igta',async()=>{calls++;return {sourceUrl:doc('igta').source.url,html:html()};},'weekly'],['gtaboss',async()=>{throw Error('source_http_403');},'weekly']]);
 assert.equal(calls,1);assert.equal(sources.documents[0].facts.length,5);assert.equal(sources.failures[0].reason,'source_http_403');assert.ok(![...data.keys()].some(k=>k.startsWith('ai:')));
 const stale=await service.websites([['igta',async()=>({sourceUrl:doc('igta').source.url,html:html('September 17, 2026','2026-09-16')}),'weekly']]);
 assert.equal(stale.documents[0].current,false);assert.equal(stale.documents[0].facts.length,0);
 assert.deepEqual(WEBSITE_SOURCES.slice(-3).map(s=>s[0]),['igta','gtaboss','reddit']);
});
