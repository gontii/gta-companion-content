import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validatePublicWeekly,issueNumber,publicState} from '../schemas/public-weekly.mjs';
import {preparePublicWeekly} from '../scripts/prepare-public-weekly.mjs';
const raw=readFileSync(new URL('../weekly/public/2638.json',import.meta.url),'utf8');
const fixture=()=>JSON.parse(raw);
const now=Date.parse('2026-09-18T12:00:00Z');
test('2638 has stable ISO numbering, including ISO year boundaries and revisions',()=>{
  for(const [day,issue] of [['2026-09-17','2638'],['2021-01-01','2053'],['2024-12-30','2501'],['2027-01-01','2653'],['2027-01-07','2701']]) assert.equal(issueNumber(day),issue);
  assert.throws(()=>issueNumber('2026-02-30'));
  const d=fixture();d.verifiedAt='2026-09-16T20:00:00.000Z';assert.equal(validatePublicWeekly(d,now).issue,'2638');
});
test('preview does not activate on Thursday, confirmation and expiry are separate',()=>{
  const d=fixture();
  assert.equal(publicState(d,Date.parse('2026-09-16')),'preview');
  assert.equal(publicState(d,Date.parse('2026-09-17T12:00:00Z')),'preview');
  d.status='active';d.confirmedAt='2026-09-17T12:00:00.000Z';d.verifiedAt=d.confirmedAt;
  validatePublicWeekly(d,now);assert.equal(publicState(d,now),'active');
  assert.equal(publicState(d,Date.parse('2026-09-24')),'ended');
  d.confirmedAt='2026-09-16T12:00:00.000Z';assert.throws(()=>validatePublicWeekly(d,now));
});
test('strict public contract rejects app payload, access data, unknown fields, invalid dates and unsafe text',()=>{
  for(const mutate of [
    d=>d.quickTake=['Do this first'],d=>d.accessToken='secret',d=>d.issue='2639',
    d=>d.sections[0].items[0].checklist=['task'],d=>d.sources[0].url='javascript:alert(1)',
    d=>d.sections[0].items[0].offer='<script>bad</script>',
    d=>d.sections[0].items[0].endsOn='2026-09-16',
    d=>d.sections[0].items[0].sourceIds=['missing'],
    d=>d.sections[5].items[0].offer='Old podium car',
    d=>d.sections[4].items[0].gtaPlus=false,
    d=>d.sections[0].items[0].id=d.sections[0].items[1].id,
    d=>d.verifiedAt='2099-09-17T12:00:00.000Z'
  ]){const d=fixture();mutate(d);assert.throws(()=>validatePublicWeekly(d,now));}
  assert.throws(()=>validatePublicWeekly(JSON.parse(readFileSync(new URL('../weekly/latest.json',import.meta.url))),now));
});
test('2638 editorial facts match known seasonal challenge, keep membership dates and exclude stale rotations',()=>{
  const d=validatePublicWeekly(fixture(),now),items=d.sections.flatMap(s=>s.items),find=id=>items.find(i=>i.id===id);
  const event=JSON.parse(readFileSync(new URL('../events/business-rivalries-2026-09.json',import.meta.url)));
  const challenge=event.weeks.find(w=>w.startsOn===d.weekId);
  assert.equal(challenge.targetCount,3);assert.match(find('business-rivalries-2026-09-17').requirements,/three Bunker Research Missions/);
  assert.ok(find('business-rivalries-2026-09-17').offer.includes(challenge.outfit));
  assert.equal(find('la-coureuse-qualification').endsOn,event.vehicleReward.qualifyUntil);
  assert.equal(find('la-coureuse-qualification').claim.endsOn,event.vehicleReward.claimUntil);
  assert.ok(d.sections.find(s=>s.id==='gta-plus').items.every(i=>i.endsOn==='2026-10-07'&&i.gtaPlus));
  assert.equal(find('gta-plus-2026-09-bike-service').offer,'3X GTA$ and RP.');
  assert.match(find('gta-plus-2026-09-cluckin').offer,/first finale/);
  assert.ok(d.sections.find(s=>s.id==='rotations').items.every(i=>i.status==='pending'));
  assert.doesNotMatch(raw,/6X|Grapeseed Clubhouse|Karin S95|Junk Tracksuit/);
});
test('public KV preparation never writes app key; active release requires paired, complete, unchanged editorial approval',()=>{
  assert.deepEqual(preparePublicWeekly(raw,{now}).map(x=>x.key),['weekly:public']);
  const d=fixture();d.status='active';d.confirmedAt='2026-09-17T12:00:00.000Z';d.verifiedAt=d.confirmedAt;
  const publicText=JSON.stringify(d),appText=JSON.stringify({...JSON.parse(readFileSync(new URL('../weekly/latest.json',import.meta.url))),weekId:d.weekId,range:'September 17 - 23, 2026'});
  const sha=s=>createHash('sha256').update(s).digest('hex');
  const review={status:'zatwierdzone',publicSha256:sha(publicText),appSha256:sha(appText),reviewedAt:'2026-09-17T13:00:00.000Z',checkedFactIds:d.sections.flatMap(s=>s.items).filter(i=>i.status==='confirmed').map(i=>i.id)};
  assert.throws(()=>preparePublicWeekly(publicText,{now}));
  assert.throws(()=>preparePublicWeekly(publicText,{appText,review:{...review,checkedFactIds:[]},now}));
  assert.throws(()=>preparePublicWeekly(publicText+' ',{appText,review,now}));
  assert.throws(()=>preparePublicWeekly(publicText,{appText:JSON.stringify({weekId:'2026-09-10'}),review,now}));
  assert.equal(preparePublicWeekly(publicText,{appText,review,now})[0].key,'weekly:public');
});
