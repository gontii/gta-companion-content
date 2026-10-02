import { validDay, windowFromDays, addDays, localParts, normalizeWeeklyTiming, isWeeklyPeriod } from './temporal.mjs';
import { thursdayWeekId, extractDateRange, extractPublishedWeekId, cleanText, stripTags, buildWeeklyContent } from './weekly-core.mjs';
import editorialPeriods from '../events/editorial-periods.json' with { type: 'json' };

export const SECTION_TITLES = {
  bonuses: 'Best bonuses', challenge: 'Weekly challenge', 'free-vehicles': 'Free rewards & prize vehicles',
  discounts: 'Discounts & Offers', 'gun-van': 'Gun Van', other: 'Other weekly items', 'gta-plus': 'GTA+ benefits',
};
export const FACT_VALIDATION_VERSION = 10;
export const normal = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const numbers = s => (String(s).replace(/(?<=\d)[, ](?=\d{3}\b)/g, '').match(/\d+(?:\.\d+)?/g) || []).sort();
export const factKey = f => [f.section, normal(f.entity), f.eligibility, f.platform].join(':');
export { factSignature } from './offer-traits.mjs';
import { factSignature } from './offer-traits.mjs';
export function factWindow(f) {
  return { ...windowFromDays(f.startsOn, f.endsOn, f.windowPolicy !== 'independent' && f.section !== 'gta-plus' && !f.sources?.some(s => s.scope === 'membership') && isWeeklyPeriod(f.startsOn, f.endsOn)), ...(f.timing || {}) };
}
export async function hash(value) {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
}
export function articleDocument(source, now = new Date()) {
  const html = source.html;
  const publishedOn = extractPublishedWeekId(html);
  const selected = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || html;
  const text = stripTags(selected.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));
  let period = extractDateRange(html, { publishedWeekId: publishedOn, now });
  let periodEvidence;
  // iGTA dates the named weekly edition, not its Wednesday publication. A
  // Thursday weekly title defines the seven-day window; retain the exact title
  // as evidence and never synthesize a quote claiming an explicit end date.
  if (!period && source.kind === 'igta') {
    const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
    const match = /^This Week in GTA Online:\s*([A-Za-z]+ \d{1,2}, 20\d{2})$/.exec(title);
    const start = match && Date.parse(match[1] + ' UTC');
    if (Number.isFinite(start) && new Date(start).getUTCDay() === 4 && new Date(start).getUTCDate() === Number(match[1].match(/\d+/)[0])) {
      const startId = new Date(start).toISOString().slice(0, 10);
      period = { startId, endId: addDays(startId, 6), rangeText: title };
      periodEvidence = title;
    }
  }
  let cards = '';
  try {
    const parsed = buildWeeklyContent(html, { now, sourceUrl: source.sourceUrl });
    cards = parsed.sections.map(s => `${s.title}:\n${s.items.map(i => i.label).join('\n')}`).join('\n');
  } catch { /* A partial article can still supply independently grounded facts. */ }
  const titledText = periodEvidence ? `${periodEvidence}\n${text}` : text;
  const normalized = cards && !['igta', 'gtaboss', 'reddit'].includes(source.kind) ? `Structured offers parsed from the article (${period?.rangeText || ''}):\n${cards}\n\nArticle:\n${titledText}` : titledText;
  return { ...source, text: normalized.slice(0, 35_000), publishedOn, period, ...(periodEvidence ? { periodEvidence } : {}),
    source: { url: source.sourceUrl, kind: source.kind, scope: source.scope || 'weekly', publishedOn } };
}

export function periodIsSupported(start, end, evidence, doc) {
  if (!validDay(start) || !validDay(end)) return false;
  if (doc.source.kind === 'igta' && doc.periodEvidence && evidence === doc.periodEvidence &&
      start === doc.period?.startId && end === doc.period?.endId) return true;
  // A complete range must match both endpoints; unrelated numbers in a paragraph
  // and one month name cannot prove a cross-month period.
  const months = 'January February March April May June July August September October November December'.split(' ');
  const month = months[new Date(start).getUTCMonth()];
  const endMonth = months[new Date(end).getUTCMonth()];
  const day = new Date(start).getUTCDate(), last = new Date(end).getUTCDate();
  const word = m => m.slice(0, 3) + '[a-z]*';
  const dash = '(?:[-–—]|through|to)';
  const pattern = new RegExp(`\\b${word(month)}\\s+${day}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?\\s*${dash}\\s*${month === endMonth ? '(?:' + word(endMonth) + '\\s+)?' : word(endMonth) + '\\s+'}${last}(?:st|nd|rd|th)?\\b`, 'i');
  if (evidence.includes(start) && evidence.includes(end) || pattern.test(evidence)) return true;
  // An explicit whole month is an independent window, never the event week.
  if (day === 1 && last === new Date(Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth() + 1, 0)).getUTCDate() && month === endMonth &&
      new RegExp(`(?:all ${word(month)} long|throughout ${word(month)})`, 'i').test(evidence)) return true;
  // Explicit time evidence can describe the endpoints in two separate clauses.
  if (/\d{1,2}:\d{2}/.test(evidence) && evidence.toLowerCase().includes(month.toLowerCase()) && evidence.toLowerCase().includes(endMonth.toLowerCase())) {
    return new RegExp(`\\b${word(month)}\\s+${day}\\b`, 'i').test(evidence) && new RegExp(`\\b${word(endMonth)}\\s+${last}\\b`, 'i').test(evidence);
  }
  return false;
}

export function validateFacts(raw, doc) {
  if (!raw || !Array.isArray(raw.facts) || raw.facts.length > 90) throw new Error('facts_schema_invalid');
  const accepted = [], rejected = [];
  for (const f of raw.facts) {
    try {
      if (!Object.hasOwn(SECTION_TITLES, f.section) || !['all', 'gta-plus', 'unknown'].includes(f.eligibility) ||
          !['all', 'enhanced', 'legacy', 'unknown'].includes(f.platform)) throw new Error('classification');
      if (f.eligibility === 'unknown' || f.platform === 'unknown') throw new Error('eligibility_unknown');
      for (const key of ['entity', 'offer', 'evidence', 'dateEvidence']) {
        if (typeof f[key] !== 'string' || !f[key].trim() || f[key].length > 650) throw new Error('missing_evidence');
      }
      const evidence = normal(f.evidence), dateEvidence = normal(f.dateEvidence), text = normal(doc.text);
      if (!text.includes(evidence) || !text.includes(dateEvidence) || !evidence.includes(normal(f.entity))) throw new Error('evidence_not_found');
      if (numbers(f.offer).some(n => !numbers(f.evidence).includes(n))) throw new Error('unsupported_number');
      // A price table contradicting its own discount is not usable evidence.
      if (doc.source.kind === 'gtaboss') {
        const prices = [...f.evidence.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map(m => Number(m[1].replaceAll(',', '')));
        const discounts = [...f.evidence.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(m => Number(m[1]));
        if (prices.length >= 2 && discounts.length === prices.length - 1 && prices[0] > 0 &&
            prices.slice(1).some((price, i) => Math.abs(price - prices[0] * (1 - discounts[i] / 100)) > 1)) {
          throw new Error('inconsistent_source_prices');
        }
      }
      if (/\bfree\b/i.test(f.offer) && !/\bfree\b|at no cost|complimentary/i.test(f.evidence)) throw new Error('unsupported_free_offer');
      const requirementChecks = [
        [/\bcomplete\b[\s\S]{0,140}\b(?:to|then|for|unlock|claim)\b/i, /complete|qualif|challenge/i],
        [/consecutive|in a row/i, /consecutive|in a row/i],
        [/\bwin\b|finish first/i, /\bwin\b|finish first/i],
        [/without dying/i, /without dying/i],
        [/first[\s\S]{0,90}(?:week|weekly)/i, /first[\s\S]{0,90}(?:week|weekly)/i],
        [/chance|lucky wheel|spin/i, /chance|lucky wheel|spin/i],
        [/\bown\b|requires? (?:an? |the )?(?:clubhouse|custom|property|business)/i, /own|require|clubhouse|custom|property|business/i],
      ];
      for (const [condition, retained] of requirementChecks) if (condition.test(f.evidence) && !retained.test(f.offer)) throw new Error('requirement_omitted');
      if (/\bRP\b/i.test(f.offer) && !/\bRP\b/i.test(f.evidence)) throw new Error('unsupported_reward_unit');
      if (/GTA\$/i.test(f.offer) && !/GTA\$/i.test(f.evidence)) throw new Error('unsupported_reward_unit');
      if (f.eligibility === 'all' && /GTA\+|GTA plus|members only/i.test(f.evidence) && !/all players|non.member|no GTA\+|no membership/i.test(f.evidence)) throw new Error('ambiguous_membership');
      if (doc.source.scope === 'membership' && f.eligibility !== 'gta-plus' &&
          !/all players|non.member|no GTA\+|no membership/i.test(f.evidence)) throw new Error('membership_source_scope');
      if (f.platform === 'all' && /enhanced|PS5|Series X|PlayStation 5/i.test(f.evidence) && !/all platforms/i.test(f.evidence)) throw new Error('ambiguous_platform');
      if (/weekend/i.test(f.evidence) && Date.parse(f.endsOn) - Date.parse(f.startsOn) > 3 * 86400000) throw new Error('weekend_dates');

      if (!validDay(f.startsOn) || !validDay(f.endsOn) || f.endsOn < f.startsOn ||
          Date.parse(f.endsOn) - Date.parse(f.startsOn) > 62 * 86_400_000) throw new Error('invalid_dates');
      if (Number.isFinite(Date.parse(doc.publishedOn)) && (Date.parse(f.startsOn) < Date.parse(doc.publishedOn) - 35 * 86_400_000 || Date.parse(f.startsOn) > Date.parse(doc.publishedOn) + 62 * 86_400_000)) throw new Error('date_outside_source_context');
      // A guessed current week cannot override a quote about a different event period.
      if (!periodIsSupported(f.startsOn, f.endsOn, f.dateEvidence, doc)) throw new Error('unsupported_dates');
      if (f.section === 'gta-plus' && f.eligibility !== 'gta-plus') throw new Error('member_scope');
      if (f.eligibility === 'gta-plus' && !/gta\+|gta plus|member/i.test(f.evidence)) throw new Error('member_evidence');
      if (f.platform === 'enhanced' && !/enhanced|ps5|series x|playstation 5/i.test(f.evidence)) throw new Error('platform_evidence');
      if (f.platform === 'legacy' && !/legacy|ps4|playstation 4|xbox one/i.test(f.evidence)) throw new Error('platform_evidence');
      if (doc.source.kind === 'tgg') {
        const chunk = doc.chunks.find(c => c.offset === f.offsetMs);
        const nearby = doc.chunks.filter(c => c.offset >= f.offsetMs && c.offset <= f.offsetMs + 90_000).map(c => c.text).join(' ');
        if (!chunk || !normal(nearby).includes(evidence)) throw new Error('timestamp_evidence');
      }
      let timing;
      if (f.timing) {
        const t = f.timing;
        if (!['Europe/Warsaw', 'UTC', 'Europe/London', 'America/New_York'].includes(t.originalZone) ||
            typeof t.evidence !== 'string' || !text.includes(normal(t.evidence))) throw new Error('time_evidence');
        const start = Date.parse(t.startsAt), end = Date.parse(t.expiresAt);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(t.startsAt) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(t.expiresAt)) throw new Error('invalid_time');
        for (const [at, day] of [[start, f.startsOn], [end, f.endsOn]]) {
          const p = localParts(at, t.originalZone);
          const date = new Date(day), month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
          const pattern = new RegExp(`(?:${day}|${month}[a-z]*\\s+${date.getUTCDate()}(?:st|nd|rd|th)?(?:,?\\s+${date.getUTCFullYear()})?)[^0-9]{0,16}(\\d{1,2}):(\\d{2})(?:\\s*(AM|PM))?`, 'gi');
          const stated = [...t.evidence.matchAll(pattern)].map(m => {
            let hour = Number(m[1]);
            if (m[3]) hour = hour % 12 + (m[3].toUpperCase() === 'PM' ? 12 : 0);
            return hour * 60 + Number(m[2]);
          });
          if (p.date !== day || !stated.includes(p.minutes)) throw new Error('time_not_supported');
        }
        const zones = { UTC: /\bUTC\b/, 'Europe/Warsaw': /\b(?:Warsaw|CET|CEST)\b/i, 'Europe/London': /\b(?:London|GMT|BST)\b/i, 'America/New_York': /\b(?:New York|ET|EST|EDT)\b/i };
        if (!zones[t.originalZone].test(t.evidence)) throw new Error('timezone_not_supported');
        timing = { startsAt: new Date(start).toISOString(), expiresAt: new Date(end).toISOString(), originalZone: t.originalZone, precision: 'time', timingConfidence: 'confirmed' };
      }
      accepted.push({ section: f.section, entity: cleanText(f.entity), offer: cleanText(f.offer), eligibility: f.eligibility,
        platform: f.platform, startsOn: f.startsOn, endsOn: f.endsOn,
        evidence: cleanText(f.evidence), dateEvidence: cleanText(f.dateEvidence),
        ...(doc.source.kind === 'tgg' ? { offsetMs: f.offsetMs } : {}), ...(timing ? { timing } : {}), sources: [doc.source] });
    } catch (error) { rejected.push({ entity: typeof f?.entity === 'string' ? f.entity.slice(0, 80) : '?', reason: error.message }); }
  }
  return { facts: accepted, rejected };
}

export function agreeSources(documents, allowTgg) {
  const official = documents.filter(d => d.source.kind === 'rockstar').flatMap(d => d.facts);
  const intel = documents.filter(d => d.source.kind === 'intel').flatMap(d => d.facts);
  const base = documents.filter(d => d.source.kind === 'gtabase').flatMap(d => d.facts);
  const periodKey = f => `${factKey(f)}:${f.startsOn}`;
  const approved = new Map(official.map(f => [periodKey(f), { ...f, confidence: 'official' }]));
  // Keep the original pair first. Extra weekly sources confirm an anchor, never
  // each other: copied community posts cannot form a self-confirming quorum.
  const extra = documents.filter(d => ['igta', 'gtaboss', 'reddit'].includes(d.source.kind) && d.current)
    .flatMap(d => d.facts);
  const pairs = [[intel, base], [intel, extra], [base, extra]];
  for (const [anchors, corroborators] of pairs) for (const f of anchors) {
    if (approved.has(periodKey(f))) continue;
    const signature = factSignature(f);
    const match = signature && corroborators.find(b => factSignature(b) === signature);
    if (match) approved.set(periodKey(f), { ...f, sources: [...f.sources, ...match.sources], confidence: 'corroborated' });
  }
  if (allowTgg && !documents.some(d => d.source.kind !== 'tgg' && d.source.scope !== 'membership' && d.current)) {
    for (const f of documents.filter(d => d.source.kind === 'tgg').flatMap(d => d.facts)) {
      if (!approved.has(periodKey(f))) approved.set(periodKey(f), { ...f, confidence: 'transcript' });
    }
  }
  return [...approved.values()];
}

export function upgradeLegacy(input) {
  const c = structuredClone(input);
  if (input.schemaVersion === 2) return normalizeWeeklyTiming(applyEditorialPeriods(c));
  const parsed = extractDateRange(c.range, { publishedWeekId: c.weekId, now: new Date(c.weekId) });
  const period = windowFromDays(c.weekId, parsed?.endId || addDays(c.weekId, 6));
  Object.assign(c, period, { schemaVersion: 2, completeness: 'partial', sources: c.sourceUrl ? [{ url: c.sourceUrl, kind: 'editorial' }] : [] });
  c.sections = c.sections.map(s => ({ ...s, completeness: 'partial', items: s.items
    .filter(i => s.id !== 'gta-plus' || !/unconfirmed|confirmation|reported|checked september/i.test(i.label))
    .map(i => ({ ...i, ...period, editorial: true, confidence: 'editorial' })) }));
  c.quickTakeEntries = c.quickTake.map((label, i) => ({ id: `quick-${i}`, label, ...period, editorial: true, confidence: 'editorial' }));
  c.beginnerPath = c.beginnerPath.map(i => ({ ...i, ...period, editorial: true, confidence: 'editorial' }));
  c.locations = (c.locations || []).map(i => ({ ...i, ...period }));
  return normalizeWeeklyTiming(applyEditorialPeriods(c));
}

function applyEditorialPeriods(c) {
  // Reviewed membership offers have their own dates, independent of the weekly reset.
  // Exact ids prevent a newly inferred offer from inheriting a reviewed period.
  for (const record of editorialPeriods) for (const section of c.sections) for (const item of section.items) {
    if (section.id === 'gta-plus' && item.timingConfidence !== 'confirmed' && item.editorial && record.itemIds.includes(item.id)) {
      Object.assign(item, windowFromDays(record.startsOn, record.endsOn, false), {
        sourceUrl: record.sourceUrl, sources: [{ kind: 'rockstar', scope: 'membership', url: record.sourceUrl }],
      });
    }
  }
  return c;
}

export function seasonalFacts(event) {
  if (!event) return [];
  const sources = [{ kind: 'rockstar', url: event.sourceUrl }];
  const make = (entity, offer, startsOn, endsOn, section) => ({ entity, offer, startsOn, endsOn, section,
    eligibility: 'all', platform: 'all', confidence: 'official', sources, ...(section === 'other' ? { windowPolicy: 'independent' } : {}) });
  return [
    ...event.weeks.map(w => ({ ...make(event.title, `${w.challenge} to receive an extra ${w.reward} and the ${w.outfit}.`, w.startsOn, w.endsOn, 'challenge'), itemId: `business-rivalries-${w.startsOn}`, ...(w.targetCount ? { targetCount: w.targetCount } : {}) })),
    make(event.vehicleReward.name, `Qualify by completing at least one Weekly Challenge; claim ${event.vehicleReward.claimFrom}–${event.vehicleReward.claimUntil}.`, event.vehicleReward.qualifyFrom, event.vehicleReward.qualifyUntil, 'other'),
    make(event.vehicleReward.name, `Claim at Legendary Motorsport if you completed a Weekly Challenge during ${event.vehicleReward.qualifyFrom}–${event.vehicleReward.qualifyUntil}.`, event.vehicleReward.claimFrom, event.vehicleReward.claimUntil, 'other'),
  ];
}

export async function mergeFacts(previous, facts, now = Date.now()) {
  const current = previous ? upgradeLegacy(previous) : null;
  const known = seasonalFacts(current?.seasonalEvent);
  // The reviewed seasonal schedule already defines the one weekly challenge.
  facts = [...facts.filter(f => !(f.section === 'challenge' && known.some(k => k.section === 'challenge' &&
    k.startsOn === f.startsOn && k.endsOn === f.endsOn))), ...known];
  const ready = facts.filter(f => Date.parse(factWindow(f).startsAt) <= now && Date.parse(factWindow(f).expiresAt) > now)
    .sort((a, b) => Date.parse(factWindow(a).startsAt) - Date.parse(factWindow(b).startsAt));
  const latestWeek = [current?.weekId, ...ready.map(f => thursdayWeekId(new Date(f.startsOn)))].filter(Boolean).sort().at(-1);
  if (!latestWeek) return null;
  const sameWeek = current?.weekId === latestWeek;
  const period = windowFromDays(latestWeek, addDays(latestWeek, 6));
  const c = sameWeek ? current : {
    schemaVersion: 2, weekId: latestWeek, range: `${latestWeek} – ${addDays(latestWeek, 6)}`,
    headline: 'This week in GTA Online', ...period, quickTake: [], quickTakeEntries: [], beginnerPath: [], locations: [],
    sections: Object.entries(SECTION_TITLES).map(([id, title]) => ({ id, title, completeness: 'pending', items: [] })),
    sources: [], completeness: 'partial',
  };
  // Longer-lived verified offers survive the week transition.
  if (!sameWeek && current) for (const s of current.sections) {
    const target = c.sections.find(t => t.id === s.id);
    if (target) target.items = s.items.filter(i => Date.parse(i.expiresAt) > now);
  }
  if (!sameWeek && current?.seasonalEvent && current.seasonalEvent.endsOn >= new Date(now).toISOString().slice(0, 10)) c.seasonalEvent = structuredClone(current.seasonalEvent);
  for (const f of ready) {
    if (thursdayWeekId(new Date(f.startsOn)) > latestWeek) continue;
    const section = c.sections.find(s => s.id === f.section);
    if (!section) continue;
    const key = factKey(f);
    const existing = section.items.find(i => f.itemId && i.id === f.itemId) || section.items.find(i => i.factKey === key) || section.items.find(i => i.editorial && normal(i.label).includes(normal(f.entity)));
    const timing = factWindow(f);
    if (existing?.confidence === 'official' && f.confidence !== 'official' && Date.parse(existing.expiresAt) > now &&
        Date.parse(existing.startsAt) >= Date.parse(timing.startsAt)) continue;
    // Keep a manual correction, its id and its original validity period.
    if (existing?.editorial && Date.parse(existing.expiresAt) > now) continue;
    const id = existing?.id || f.itemId || `auto-${(await hash(key)).slice(0, 18)}`;
    const label = `${f.entity} — ${f.offer}${f.eligibility === 'gta-plus' ? ' (GTA+ only)' : ''}${f.platform === 'enhanced' ? ' (PS5, Xbox Series X|S, PC Enhanced)' : f.platform === 'legacy' ? ' (Legacy)' : ''}`;
    const item = { id, label, factKey: key, ...timing, ...(f.windowPolicy ? { windowPolicy: f.windowPolicy } : {}), confidence: f.confidence, sources: f.sources,
      entity: f.entity, offer: f.offer, eligibility: f.eligibility, platform: f.platform, sourceUrl: f.sources[0].url, evidence: f.evidence, dateEvidence: f.dateEvidence,
      ...(f.targetCount ? { targetCount: f.targetCount } : {}),
      ...(f.offsetMs !== undefined ? { videoId: f.sources[0].videoId, offsetMs: f.offsetMs } : {}) };
    section.items = section.items.filter(i => i.id !== id);
    section.items.push(item);
    section.completeness = 'partial';
  }
  // One free property/reward must not appear again as a 100% discount.
  const rewards = c.sections.find(s => s.id === 'free-vehicles')?.items || [];
  const discounts = c.sections.find(s => s.id === 'discounts');
  if (discounts) discounts.items = discounts.items.filter(item => !rewards.some(reward => {
    const sameEntity = item.entity && reward.entity && normal(item.entity) === normal(reward.entity);
    return sameEntity && item.startsAt === reward.startsAt && item.expiresAt === reward.expiresAt &&
      item.eligibility === reward.eligibility && item.platform === reward.platform &&
      /free|GTA\$0\b|100% off/i.test(item.offer || item.label) && /free|GTA\$0\b/i.test(reward.offer || reward.label);
  }));
  for (const section of c.sections) section.items.sort((a, b) => a.editorial && b.editorial ? 0 : a.editorial ? -1 : b.editorial ? 1 : a.id.localeCompare(b.id));
  if (!c.quickTakeEntries?.some(i => i.editorial)) c.quickTakeEntries = c.sections.flatMap(s => s.items).slice(0, 4).map(i => ({ ...i, itemIds: [i.id] }));
  if (!c.beginnerPath.some(i => i.editorial)) c.beginnerPath = c.sections.filter(s => ['challenge', 'free-vehicles', 'bonuses'].includes(s.id)).flatMap(s => s.items).slice(0, 4).map(i => ({ ...i, id: `bp-${i.id}`, itemIds: [i.id] }));
  c.sources = [...new Map(c.sections.flatMap(s => s.items.flatMap(i => i.sources || [])).map(s => [s.url, s])).values()];
  if (!c.sources.length && current?.sources) c.sources = current.sources;
  c.sourceUrl = c.sources[0]?.url || current?.sourceUrl || null;
  c.quickTake = c.quickTakeEntries.map(i => i.label);
  return c;
}

export function validateSnapshot(c, { published = false } = {}) {
  if (c?.schemaVersion !== 2 || !validDay(c.weekId) || !Array.isArray(c.sections)) throw new Error('snapshot_invalid');
  const ids = new Set();
  for (const item of c.sections.flatMap(s => s.items)) {
    if (!item.id || !item.label || ids.has(item.id) || !Number.isFinite(Date.parse(item.startsAt)) ||
        !Number.isFinite(Date.parse(item.expiresAt)) || item.startsAt >= item.expiresAt) throw new Error('snapshot_item_invalid');
    ids.add(item.id);
    if (!item.editorial && !['official', 'corroborated', 'transcript', ...(published ? ['editorial'] : [])].includes(item.confidence)) throw new Error('unverified_item');
  }
  if (new TextEncoder().encode(JSON.stringify(c)).length > 120_000) throw new Error('snapshot_too_large');
  return c;
}
