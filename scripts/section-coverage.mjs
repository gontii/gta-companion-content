// Required areas are measured separately from freshness and total offer count.
// One populated category cannot prove that its vehicle rotations are complete.
export const REQUIRED_AREAS = [
  { id:'bonuses', section:'bonuses' },
  { id:'challenge', section:'challenge' },
  { id:'rewards', section:'free-vehicles', exclude:/podium|lucky wheel|prize ride|LS Car Meet/i },
  { id:'podium', section:'free-vehicles', match:/podium|lucky wheel/i },
  { id:'prize-ride', section:'free-vehicles', match:/prize ride|LS Car Meet/i },
  { id:'discounts', section:'discounts' },
  { id:'gun-van-stock', section:'gun-van' },
  { id:'gun-van-discounts', section:'gun-van', match:/\d+%\s*off|FREE/i, eligibility:'all' },
  { id:'gun-van-gta-plus', section:'gun-van', match:/\d+%\s*off|FREE/i, eligibility:'gta-plus' },
  { id:'other', section:'other' },
  { id:'gta-plus', section:'gta-plus' },
];
const text = item => item.label || `${item.entity || ''} — ${item.offer || ''}`;
const matches = (area,item) => (!area.match || area.match.test(text(item))) &&
  (!area.exclude || !area.exclude.test(text(item))) &&
  (!area.eligibility || (item.eligibility || (/GTA\+ only|GTA\+ membership required/i.test(text(item))?'gta-plus':'all'))===area.eligibility);
const absenceNames = {
  bonuses:'bonuses', challenge:'weekly challenge', rewards:'free rewards', podium:'podium vehicle',
  'prize-ride':'Prize Ride', discounts:'discounts', 'gun-van-stock':'Gun Van stock',
  'gun-van-discounts':'regular Gun Van discounts', 'gun-van-gta-plus':'GTA\\+ Gun Van discounts',
  other:'other weekly activities', 'gta-plus':'GTA\\+ benefits',
};
export function collectSectionEvidence(documents,weekId,day) {
  const candidates=Object.fromEntries(REQUIRED_AREAS.map(a=>[a.id,0]));
  const absences=[];
  for(const doc of documents.filter(d=>d.current)) {
    for(const fact of doc.facts || []) {
      if(fact.startsOn>day || fact.endsOn<day) continue;
      for(const area of REQUIRED_AREAS) if(area.section===fact.section && matches(area,fact)) candidates[area.id]++;
    }
    // An omission or an empty extraction is never proof that there is no offer.
    if(doc.period?.startId!==weekId || Date.parse(doc.period.endId)-Date.parse(weekId)!==6*86400000) continue;
    for(const area of REQUIRED_AREAS) {
      const sentence=new RegExp(`\\bNo ${absenceNames[area.id]} (?:are available )?this week\\b`,'i');
      if(sentence.test(doc.text || '')) absences.push({area:area.id,kind:doc.source.kind,url:doc.source.url});
    }
  }
  return {weekId,candidates,absences};
}
const trustedAbsence = declarations => declarations.some(d=>d.kind==='rockstar') ||
  declarations.some(d=>['intel','gtabase'].includes(d.kind) && declarations.some(other=>other.kind!==d.kind && ['intel','gtabase','igta','gtaboss','reddit'].includes(other.kind)));
export function inspectSectionCoverage(snapshot,evidence,now,weekId,expectedAt) {
  const deadlineAt=expectedAt+15*60000;
  const current=snapshot?.weekId===weekId;
  const sections=current ? snapshot.sections || [] : [];
  const active=item=>Number.isFinite(Date.parse(item?.startsAt)) && Number.isFinite(Date.parse(item?.expiresAt)) && now>=Date.parse(item?.startsAt) && now<Date.parse(item?.expiresAt);
  const rows=REQUIRED_AREAS.map(area=>{
    const confirmed=(sections.find(s=>s.id===area.section)?.items || []).filter(i=>active(i) && matches(area,i)).length;
    const declarations=evidence?.weekId===weekId ? (evidence.absences || []).filter(d=>d.area===area.id) : [];
    const candidates=evidence?.weekId===weekId ? evidence.candidates?.[area.id] || 0 : 0;
    const absent=trustedAbsence(declarations);
    const state=absent && confirmed ? 'unconfirmed' : confirmed ? 'confirmed' : absent ? 'absent' : candidates || declarations.length ? 'unconfirmed' : 'missing';
    return {id:area.id,section:area.section,state,confirmedItems:confirmed,candidateFacts:candidates};
  });
  const unresolved=rows.filter(r=>['missing','unconfirmed'].includes(r.state)).map(r=>r.id);
  const counts=sections.filter(s=>s.id!=='dlc').map(s=>({id:s.id,confirmedItems:s.items.filter(active).length}));
  return {weekId,checkedAt:new Date(now).toISOString(),deadlineAt:new Date(deadlineAt).toISOString(),
    alarm:now>=deadlineAt && unresolved.length>0,areas:rows,sections:counts,
    resolvedAreas:rows.length-unresolved.length,requiredAreas:rows.length,unresolved};
}

// The receipt is private Worker output. Reject old or malformed coverage rather
// than letting last week's absence declarations mark the current edition complete.
export function reportedSectionCoverage(app, receipt, now, weekId, expectedAt) {
  const value=receipt?.sectionCoverage;
  const checked=Date.parse(value?.checkedAt);
  const valid=value?.weekId===weekId && receipt?.weekId===weekId &&
    value?.revision===app?.revision && Number.isFinite(checked) && checked<=now && now-checked<=45*60000 &&
    Array.isArray(value.areas) && value.areas.length===REQUIRED_AREAS.length &&
    REQUIRED_AREAS.every(a=>value.areas.filter(r=>r.id===a.id && r.section===a.section &&
      ['confirmed','absent','missing','unconfirmed'].includes(r.state) &&
      Number.isSafeInteger(r.confirmedItems) && r.confirmedItems>=0 &&
      Number.isSafeInteger(r.candidateFacts) && r.candidateFacts>=0 &&
      (r.state==='confirmed' ? r.confirmedItems>0 : r.state!=='absent' || r.confirmedItems===0)).length===1);
  const coverage=valid ? structuredClone(value) : inspectSectionCoverage(app,null,now,weekId,expectedAt);
  coverage.unresolved=coverage.areas.filter(r=>['missing','unconfirmed'].includes(r.state)).map(r=>r.id);
  coverage.resolvedAreas=REQUIRED_AREAS.length-coverage.unresolved.length;
  coverage.requiredAreas=REQUIRED_AREAS.length;
  coverage.deadlineAt=new Date(expectedAt+15*60000).toISOString();
  coverage.alarm=now>=expectedAt+15*60000 && coverage.unresolved.length>0;
  coverage.receiptCurrent=!!valid;
  return coverage;
}
