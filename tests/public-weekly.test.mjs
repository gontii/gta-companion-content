import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validatePublicWeekly,issueNumber,publicState} from '../schemas/public-weekly.mjs';
import {preparePublicWeekly} from '../scripts/prepare-public-weekly.mjs';
const raw=readFileSync(new URL('../weekly/public/2638.json',import.meta.url),'utf8');
// Testy historycznych stanów mają własny czas, niezależny od kolejnej korekty źródeł.
const fixture=()=>{
  const d=JSON.parse(raw);
  d.verifiedAt='2026-09-15T18:05:31.320Z';
  for(const source of d.sources) source.verifiedAt=d.verifiedAt;
  return d;
};
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
    d=>d.sections.find(s=>s.id==='rotations').items.find(i=>i.status==='pending').offer='Unconfirmed detail',
    d=>d.sections[4].items[0].gtaPlus=false,
    d=>d.sections[0].items[0].id=d.sections[0].items[1].id,
    d=>d.verifiedAt='2099-09-17T12:00:00.000Z'
  ]){const d=fixture();mutate(d);assert.throws(()=>validatePublicWeekly(d,now));}
  assert.throws(()=>validatePublicWeekly(JSON.parse(readFileSync(new URL('../weekly/latest.json',import.meta.url))),now));
});
test('2638 editorial facts match known seasonal challenge, keep membership dates and exclude stale rotations',()=>{
  const d=validatePublicWeekly(JSON.parse(raw),now),items=d.sections.flatMap(s=>s.items),find=id=>items.find(i=>i.id===id);
  const event=JSON.parse(readFileSync(new URL('../events/business-rivalries-2026-09.json',import.meta.url)));
  const challenge=event.weeks.find(w=>w.startsOn===d.weekId);
  assert.equal(challenge.targetCount,3);assert.match(find('business-rivalries-2026-09-17').requirements,/three Bunker Research Missions/);
  assert.ok(find('business-rivalries-2026-09-17').offer.includes(challenge.outfit));
  assert.equal(find('la-coureuse-qualification').endsOn,event.vehicleReward.qualifyUntil);
  assert.equal(find('la-coureuse-qualification').claim.endsOn,event.vehicleReward.claimUntil);
  assert.ok(d.sections.find(s=>s.id==='gta-plus').items.every(i=>i.endsOn==='2026-10-07'&&i.gtaPlus));
  assert.equal(find('gta-plus-2026-09-bike-service').offer,'3X GTA$ and RP.');
  assert.match(find('gta-plus-2026-09-cluckin').offer,/first finale/);
  assert.equal(find('podium-vehicle').name,'Vapid Dominator ASP');
  assert.equal(find('prize-ride').name,'Dinka LSCM Jester RR');
  assert.match(find('prize-ride').requirements,/four consecutive days/);
  assert.match(find('gun-van').requirements,/30% off for GTA\+ members only/);
  assert.equal(find('test-rides').status,'pending');
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
  const wrongRange=JSON.stringify({...JSON.parse(appText),range:'September 17 - 30, 2026'});
  assert.throws(()=>preparePublicWeekly(publicText,{appText:wrongRange,review:{...review,appSha256:sha(wrongRange)},now}),/okresy/);
  const isoRange=JSON.stringify({...JSON.parse(appText),range:'2026-09-17 – 2026-09-23'});
  assert.equal(preparePublicWeekly(publicText,{appText:isoRange,review:{...review,appSha256:sha(isoRange)},now})[0].key,'weekly:public');
});

test('rolling page validates both editions, removes old offers and never auto-confirms', async()=>{
  const {validatePublicPage,visiblePublicEditions}=await import('../schemas/public-weekly.mjs');
  const current=JSON.parse(readFileSync(new URL('../weekly/public/2637.json',import.meta.url)));
  assert.doesNotMatch(JSON.stringify(current),/ends before this edition|has ended before this edition/);
  const page={schemaVersion:1,editions:[current,fixture()]};
  assert.equal(validatePublicPage(page,now).editions.length,2);
  assert.deepEqual(visiblePublicEditions(page,Date.parse('2026-09-16T22:00:00Z')).map(d=>d.issue),['2637','2638']);
  assert.deepEqual(visiblePublicEditions(page,now).map(d=>d.issue),['2638']);
  assert.equal(publicState(visiblePublicEditions(page,now)[0],now),'preview');
  assert.equal(publicState(visiblePublicEditions(page,Date.parse('2026-09-24'))[0],Date.parse('2026-09-24')),'ended');
  assert.throws(()=>validatePublicPage({...page,accessToken:'private'},now));
  assert.throws(()=>validatePublicPage({...page,editions:[current,current]},now));
  const changed=structuredClone(page);changed.editions[1].accessToken='private';assert.throws(()=>validatePublicPage(changed,now));
});
test('empty weekly skeleton computes ISO dates without inheriting offers or pretending verification',async()=>{
  const {newPublicWeekly}=await import('../scripts/new-public-weekly.mjs');
  const d=newPublicWeekly('2026-12-31');assert.equal(d.issue,'2653');assert.equal(d.endsOn,'2027-01-06');
  assert.equal(d.verifiedAt,null);assert.equal(d.confirmedAt,null);assert.deepEqual(d.sources,[]);
  assert.ok(d.sections.flatMap(s=>s.items).every(i=>i.status==='pending'&&i.offer===null));
  assert.throws(()=>validatePublicWeekly(d,now));
});
test('public archive index is strict and issue keys stay separate from application data',()=>{
  const d=fixture(),index=[{issue:'2637',startsOn:'2026-09-10',endsOn:'2026-09-16'}];
  const bulk=preparePublicWeekly(raw,{archiveIndex:index,now});
  assert.equal(bulk[0].key,'weekly:public');assert.deepEqual(JSON.parse(bulk[0].value).archive,index);
  assert.throws(()=>preparePublicWeekly(raw,{archiveIndex:[{...index[0],accessToken:'private'}],now}));
  assert.throws(()=>preparePublicWeekly(raw,{archiveIndex:[index[0],index[0]],now}));
  const archive=preparePublicWeekly(raw,{target:'archive',now});assert.equal(archive[0].key,'weekly:public:2638');
  d.status='active';d.confirmedAt='2026-09-17T10:00:00.000Z';d.verifiedAt=d.confirmedAt;
  assert.throws(()=>preparePublicWeekly(JSON.stringify(d),{target:'archive',now}),/odbioru/);
});
