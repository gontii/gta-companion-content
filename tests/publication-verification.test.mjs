import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyAppRender} from '../scripts/publication-verification.mjs';
import {hash} from '../scripts/facts.mjs';
import {projectContent} from '../scripts/temporal.mjs';
const publication=JSON.parse(await readFile(new URL('./fixtures/weekly-legacy.json',import.meta.url)));
publication.revision='a'.repeat(64);
const now=Date.parse('2026-09-17T12:00:00Z');
async function live(){return {appRender:{schemaVersion:1,algorithm:'sha256',revision:publication.revision,renderedAt:new Date(now).toISOString(),digest:await hash(projectContent(publication,now))}};}
test('odbiór porównuje pełną projekcję i potwierdza 401 bez konta użytkownika',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response('',{status:401});});
 const proof=await verifyAppRender(await live(),publication,now);
 assert.equal(proof.mode,'render-digest-v1');assert.equal(proof.unauthenticatedStatus,401);assert.equal(calls.length,1);
 assert.equal(new Headers(calls[0].options?.headers).has('authorization'),false);
});
test('brak, inna rewizja, algorytm i stary czas nie przechodzą odbioru',async()=>{
 for(const patch of [null,{revision:'b'.repeat(64)},{schemaVersion:2},{algorithm:'sha1'},{renderedAt:'bad'},{renderedAt:new Date(now-60001).toISOString()}]){
  const s=await live();s.appRender=patch===null?null:{...s.appRender,...patch};
  await assert.rejects(()=>verifyAppRender(s,publication,now),/weekly_render_proof_invalid/);
 }
});
test('identyczna rewizja z innym skrótem nie przechodzi odbioru',async()=>{
 const s=await live();s.appRender.digest='0'.repeat(64);await assert.rejects(()=>verifyAppRender(s,publication,now),/weekly_render_content_mismatch/);
});
test('API bez bramki lub z awarią nie przechodzi odbioru',async t=>{
 for(const code of [200,403,500]){
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:code}));
  const s=await live();await assert.rejects(()=>verifyAppRender(s,publication,now),new RegExp(`weekly_auth_gate_http_${code}`));
  t.mock.restoreAll();
 }
});
