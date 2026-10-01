import { stripTags, extractDateRange } from './weekly-core.mjs';
import { validateFacts } from './facts.mjs';
// Deterministic extraction for dated list rows. Separate lists never inherit the
// first range in an article (weekly, month, member and claim windows differ).
export function extractRockstarFacts(doc) {
  if (doc.source.kind !== 'rockstar' || !doc.html) return { facts: [], rejected: [] };
  const facts = [];
  let discountPeriod = null, discountEvidence = '';
  for (const [block, tag, html] of doc.html.matchAll(/<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = stripTags(html);
    if (/^h/.test(tag)) {
      discountPeriod = null;
      if (/^Additional Discounts:/i.test(text)) {
        discountPeriod = extractDateRange(text, { publishedWeekId: doc.publishedOn, now: new Date(doc.publishedOn) });
        discountEvidence = text;
      }
      continue;
    }
    const add = (section, entity, offer, period, dateEvidence, evidence = text) => facts.push({ section, entity, offer,
      eligibility: doc.source.scope === 'membership' ? 'gta-plus' : 'all', platform: 'all',
      startsOn: period.startId, endsOn: period.endId, evidence, dateEvidence });
    const discount = /^(.+?)\s*\([^)]*\)\s*[-–—]\s*(\d+)% off\s*$/i.exec(text);
    if (discount && discountPeriod) add('discounts', discount[1], `${discount[2]}% off`, discountPeriod, discountEvidence);
    const challenge = /^(October\s+\d+\s*[-–—]\s*(?:November\s+)?\d+):\s*(Secure|Win|Complete)\s+(.+?)\s+to get\s+(.+)$/i.exec(text);
    if (challenge) {
      const period = extractDateRange(challenge[1], { publishedWeekId: doc.publishedOn, now: new Date(doc.publishedOn) });
      if (period) add('challenge', challenge[3].replace(/^(two|three|all waves of a|10 waves in a)\s+/i, ''), `${challenge[2]} ${challenge[3]} to receive ${challenge[4]}.`, period, challenge[1]);
    }
    // Only an explicit calendar-month clause can ground a calendar-month bonus.
    if (/2X GTA\$ and RP all October long/i.test(text) && doc.publishedOn?.slice(5,7) === '10') {
      const period = { startId: doc.publishedOn.slice(0,4)+'-10-01', endId: doc.publishedOn.slice(0,4)+'-10-31' };
      for (const entity of ['Standard and Most Wanted Bail Office Targets', 'Dispatch Work']) {
        if (text.includes(entity)) add('bonuses', entity, '2X GTA$ & RP', period, text);
      }
    }
  }
  return validateFacts({ facts }, doc);
}
