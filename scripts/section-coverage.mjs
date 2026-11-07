import { atLocal, addDays, localParts } from './temporal.mjs';

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
export const AREA_LABELS = {
  bonuses:'bonusy', challenge:'wyzwanie tygodnia', rewards:'darmowe nagrody', podium:'pojazd na podium',
  'prize-ride':'Prize Ride', discounts:'zniżki', 'gun-van-stock':'asortyment Gun Van',
  'gun-van-discounts':'zniżki Gun Van', 'gun-van-gta-plus':'zniżki Gun Van dla GTA+',
  other:'pozostałe aktywności', 'gta-plus':'korzyści GTA+',
};
// Thursday 13:00 Europe/Warsaw, two hours after the 11:00 reset. Sources and
// subtitle retries need that window; an earlier alarm fired while the edition
// was still arriving.
export const COMPLETENESS_LOCAL_MINUTES = 13 * 60;
export function completenessDeadline(weekId, expectedAt) {
  if (typeof weekId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weekId)) {
    try { return atLocal(weekId, COMPLETENESS_LOCAL_MINUTES); } catch { /* use the fallback below */ }
  }
  return expectedAt + 2 * 60 * 60 * 1000;
}
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
  const deadlineAt=completenessDeadline(weekId, expectedAt);
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
  const deadlineAt=completenessDeadline(weekId, expectedAt);
  coverage.deadlineAt=new Date(deadlineAt).toISOString();
  coverage.alarm=now>=deadlineAt && coverage.unresolved.length>0;
  coverage.receiptCurrent=!!valid;
  return coverage;
}

// A published bonus must name a start and end that overlap this Thursday–Wednesday
// window. A later window is not this week's bonus.
export function inspectBonusPeriods(snapshot) {
  if (!snapshot?.weekId || !Array.isArray(snapshot.sections)) return [];
  const weekId = snapshot.weekId;
  const weekEnd = addDays(weekId, 6);
  const issues = [];
  for (const item of snapshot.sections.find(section => section.id === 'bonuses')?.items || []) {
    const startMs = Date.parse(item?.startsAt);
    const endMs = Date.parse(item?.expiresAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      issues.push({ id: item?.id || null, label: item?.label || '', reason: 'missing-dates' });
      continue;
    }
    const start = localParts(startMs).date;
    const endAt = localParts(endMs);
    const end = endAt.minutes === 0 || endAt.minutes === 660 ? addDays(endAt.date, -1) : endAt.date;
    if (end < weekId || start > weekEnd) issues.push({ id: item.id, label: item.label, startsOn: start, endsOn: end, reason: 'outside-week' });
  }
  return issues;
}

export function stampCompleteness(snapshot, coverage) {
  const bonusPeriodIssues = inspectBonusPeriods(snapshot);
  if (bonusPeriodIssues.length) {
    const bad = new Set(bonusPeriodIssues.map(issue => issue.id).filter(Boolean));
    for (const section of snapshot.sections || []) if (section.id === 'bonuses') section.items = (section.items || []).filter(item => !bad.has(item.id));
    snapshot.bonusPeriodIssues = bonusPeriodIssues;
    const bonuses = coverage?.areas?.find(area => area.id === 'bonuses');
    if (bonuses && !(snapshot.sections.find(section => section.id === 'bonuses')?.items || []).length && bonuses.state === 'confirmed') {
      bonuses.state = 'missing';
      bonuses.confirmedItems = 0;
      coverage.unresolved = coverage.areas.filter(area => ['missing', 'unconfirmed'].includes(area.state)).map(area => area.id);
      coverage.resolvedAreas = coverage.areas.length - coverage.unresolved.length;
    }
  } else delete snapshot.bonusPeriodIssues;
  const missing = coverage.unresolved.slice();
  snapshot.completeness = missing.length ? 'partial' : 'complete';
  snapshot.missingAreas = missing;
  snapshot.resolvedAreas = coverage.resolvedAreas;
  snapshot.requiredAreas = REQUIRED_AREAS.length;
  const held = Array.isArray(snapshot.withheldBonuses) ? snapshot.withheldBonuses : [];
  const heldNote = held.length ? ` Held outside this week: ${held.map(bonus => `${bonus.entity} ${bonus.offer} (${bonus.startsOn || '?'}–${bonus.endsOn || '?'})`).join('; ')}.` : '';
  const removedNote = snapshot.bonusPeriodIssues?.length ? ` Bonus dates outside this week or missing: ${snapshot.bonusPeriodIssues.map(issue => issue.label || issue.id).join('; ')}.` : '';
  snapshot.completenessNote = (missing.length || removedNote
    ? `Partial weekly update ${snapshot.weekId}: ${coverage.resolvedAreas}/${REQUIRED_AREAS.length} areas. Missing: ${missing.join(', ') || 'none'}.`
    : `Weekly update ${snapshot.weekId}: ${REQUIRED_AREAS.length}/${REQUIRED_AREAS.length} required areas confirmed or explicitly absent.`) + heldNote + removedNote;
  if (removedNote) snapshot.completeness = 'partial';
  for (const section of snapshot.sections || []) {
    const areas = coverage.areas.filter(area => area.section === section.id);
    if (!areas.length) continue;
    const open = areas.filter(area => missing.includes(area.id));
    section.completeness = open.length ? (section.items?.length ? 'partial' : 'pending') : 'complete';
  }
  return snapshot;
}
