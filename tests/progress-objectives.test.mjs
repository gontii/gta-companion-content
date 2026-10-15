import test from 'node:test';
import assert from 'node:assert/strict';
import { objectiveKey, deduplicateObjectives, duplicateObjectives } from '../scripts/progress-objectives.mjs';
import { classifyProgressContent, classifyProgressItem } from '../scripts/progress-classification.mjs';
import { mergeFacts, validateSnapshot } from '../scripts/facts.mjs';
import { projectContent } from '../scripts/temporal.mjs';
import event from '../events/halloween-challenges-2026-10.json' with { type:'json' };
const source = {kind:'rockstar',url:event.sourceUrl};
const base = { confidence:'official', eligibility:'all', platform:'all', startsAt:'2026-10-15T09:00:00.000Z', expiresAt:'2026-10-22T09:00:00.000Z',sources:[source] };
const canonical = {...base,id:'season-progress',entity:event.title,seasonalEventId:event.id,targetCount:3,
  offer:'Week 3/5: Win three Races to receive GTA$100,000 and the Orange Glow Skeleton Onesie. Counts towards the GTA$2,000,000 bonus for completing all five Halloween Weekly Challenges.'};
const scraped = {...base,id:'scraped-progress',entity:'Races',offer:'Win three Races to receive the Orange Glow Skeleton Onesie and GTA$100,000.'};
function content() { return {weekId:'2026-10-15',sections:[{id:'challenge',items:[structuredClone(canonical)]},{id:'other',items:[structuredClone(scraped)]}],beginnerPath:[{id:'tip',itemIds:[scraped.id]}]}; }
test('same action, reordered rewards and spelled/digit count share identity across sections',()=>{
  assert.equal(objectiveKey(canonical),objectiveKey({...scraped,offer:scraped.offer.replace('three','3')}));
  const c=content();assert.equal(duplicateObjectives(c).length,1);
  deduplicateObjectives(c);classifyProgressContent(c);
  assert.deepEqual(c.sections.flatMap(s=>s.items).map(i=>i.id),['season-progress']);
  assert.deepEqual(c.beginnerPath[0].itemIds,['season-progress']);
  assert.equal(c.sections[0].items[0].progressGroup,'primary');
  assert.equal(c.sections[0].items[0].targetCount,3);
  assert.deepEqual(deduplicateObjectives(structuredClone(c)),c);
});
test('different counts, activities, rewards, eligibility, platform or periods never collapse',()=>{
  for(const patch of [{offer:scraped.offer.replace('three','two')},{offer:scraped.offer.replace('Races','Adversary Modes')},
    {offer:scraped.offer.replace('100,000','150,000')},{offer:scraped.offer.replace('Orange Glow','Pink Glow')},
    {offer:scraped.offer.replace('Races','Races without dying')},{eligibility:'gta-plus'},{platform:'enhanced'},
    {expiresAt:'2026-10-23T09:00:00.000Z'}]) assert.notEqual(objectiveKey(canonical),objectiveKey({...scraped,...patch}));
});
test('all dated verified seasonal steps enter Main below threshold; unrelated and unverified do not',()=>{
  for(const week of event.weeks) {
    const item={...base,offer:`${week.challenge} to receive ${week.reward} and the ${week.outfit}.`};
    assert.equal(classifyProgressItem(item,'challenge',week.startsOn).progressGroup,'primary');
    assert.equal(classifyProgressItem({...item,confidence:'unconfirmed'},'challenge',week.startsOn).progressGroup,'none');
  }
  assert.equal(classifyProgressItem(scraped,'challenge','2026-11-12').progressGroup,'extra');
  assert.equal(classifyProgressItem({...scraped,sources:[{kind:'intel',url:'https://rockstarintel.com/example'}]},'challenge','2026-10-15').progressGroup,'extra');
  assert.equal(classifyProgressItem({...scraped,offer:'Win two Races to receive GTA$100,000.'},'challenge','2026-10-15').progressGroup,'extra');
});
test('publication validator refuses a semantic duplicate even with distinct ids and Main/Extra groups',()=>{
  const c={schemaVersion:2,...content()};classifyProgressContent(c);
  for(const item of c.sections.flatMap(s=>s.items))item.label=item.offer;
  c.sections[1].items[0].progressGroup='extra';
  assert.throws(()=>validateSnapshot(c),/duplicate_progress_objective/);
});
test('merge repairs stored live duplicates and repeated source extraction, preserving the Main id',async()=>{
  const c={schemaVersion:2,...content(),sources:[source],beginnerPath:[],quickTake:[],quickTakeEntries:[],locations:[]};
  for(const item of c.sections.flatMap(s=>s.items))item.label=item.offer;
  c.sections.push(...['bonuses','free-vehicles','discounts','gun-van','gta-plus'].map(id=>({id,items:[]})));
  const f={section:'challenge',entity:'Races',offer:scraped.offer,startsOn:'2026-10-15',endsOn:'2026-10-21',eligibility:'all',platform:'all',confidence:'official',sources:[source]};
  let merged=await mergeFacts(c,[f],Date.parse('2026-10-15T12:00:00Z'));
  let tasks=projectContent(merged,Date.parse('2026-10-15T12:00:00Z')).sections.flatMap(s=>s.items).filter(i=>objectiveKey(i)===objectiveKey(canonical));
  assert.equal(tasks.length,1);assert.equal(tasks[0].id,'season-progress');assert.equal(tasks[0].progressGroup,'primary');
  validateSnapshot(merged);
  merged=await mergeFacts(merged,[f],Date.parse('2026-10-15T12:15:00Z'));
  tasks=projectContent(merged,Date.parse('2026-10-15T12:15:00Z')).sections.flatMap(s=>s.items).filter(i=>objectiveKey(i)===objectiveKey(canonical));
  assert.equal(tasks.length,1);assert.equal(tasks[0].id,'season-progress');
});

test('unknown offer syntax still rejects exact repetitions across sections without fuzzy merging',()=>{
  const item={...base,id:'first',entity:'Some activity',label:'Some activity — Special verified offer',offer:'Special verified offer'};
  const c={sections:[{id:'other',items:[item]},{id:'bonuses',items:[{...item,id:'second'}]}]};
  assert.equal(duplicateObjectives(c).length,1);deduplicateObjectives(c);
  assert.equal(c.sections.flatMap(s=>s.items).length,1);
  assert.notEqual(objectiveKey(item),objectiveKey({...item,offer:'Special verified offer with an extra requirement'}));
});
