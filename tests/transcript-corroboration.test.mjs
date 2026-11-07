import test from 'node:test';
import assert from 'node:assert/strict';
import { corroborateGunVanTranscript, needsTranscriptSupplement } from '../scripts/transcript-corroboration.mjs';
import { agreeSources } from '../scripts/facts.mjs';

const video = {kind:'tgg',url:'https://www.youtube.com/watch?v=xaNctQGswYU',publishedOn:'2026-11-04T23:00:00Z'};
const base = {section:'gun-van',offer:'40% off at the Gun Van',entity:'Compact EMP Launcher',eligibility:'gta-plus',platform:'all',startsOn:'2026-11-05',endsOn:'2026-11-11',sources:[{kind:'igta',url:'https://www.igrandtheftauto.com/week'}]};
const docs = [{source:{kind:'igta'},current:true,facts:[base]}];
const chunks = [{offset:114000,text:'In the gun van this week, everyone will get 50% off the precision rifle.'},{offset:122000,text:'GTA Plus members will get 40% off the EMP launcher.'}];
test('TGG corroborates a dated source without inventing a calendar range in its transcript',()=>{
 const facts=corroborateGunVanTranscript(video,chunks,docs);
 assert.equal(facts.length,1); assert.equal(facts[0].offsetMs,122000);
 const accepted=agreeSources([...docs,{source:video,current:true,facts}],false);
 assert.equal(accepted.length,1);assert.equal(accepted[0].confidence,'corroborated');
 assert.deepEqual(accepted[0].sources.map(s=>s.kind),['igta','tgg']);
});
test('an existing current article does not end checks with unresolved offers inside a populated section',()=>{
 const at=Date.parse('2026-11-05T15:00Z');
 assert.equal(needsTranscriptSupplement(docs,[],at),true);
 assert.equal(needsTranscriptSupplement(docs,[base],at),false);
 assert.equal(needsTranscriptSupplement(docs,[],Date.parse('2026-11-12T15:00Z')),false);
});
test('wrong percentage, member scope, old video, non-Gun-Van speech and monthly windows do not corroborate',()=>{
 for(const fact of [{...base,offer:'50% off'},{...base,eligibility:'all'},{...base,endsOn:'2026-12-09'}]) {
   assert.equal(corroborateGunVanTranscript(video,chunks,[{...docs[0],facts:[fact]}]).length,0);
 }
 assert.equal(corroborateGunVanTranscript({...video,publishedOn:'2026-10-28'},chunks,docs).length,0);
 assert.equal(corroborateGunVanTranscript(video,chunks.slice(1),docs).length,0);
 assert.equal(corroborateGunVanTranscript(video,chunks,[]).length,0);
});
