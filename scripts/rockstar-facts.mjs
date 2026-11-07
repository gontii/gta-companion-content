import { stripTags, extractDateRange } from './weekly-core.mjs';
import { validateFacts, periodIsSupported } from './facts.mjs';
// Deterministic extraction for dated list rows. Separate lists never inherit the
// first range in an article (weekly, month, member and claim windows differ).
export function extractRockstarFacts(doc) {
  if (doc.source.kind !== 'rockstar' || !doc.html) return { facts: [], rejected: [] };
  const facts = [];
  const apparel = /<p\b[^>]*>Playing GTA Online throughout the month[\s\S]*?free items[\s\S]*?<\/p>\s*<ul>([\s\S]*?)<\/ul>/i.exec(doc.html);
  if (apparel && doc.source.scope !== 'membership') for (const [, row] of apparel[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const evidence = stripTags(row);
    const match = /^(October\s+\d+\s*[-–—]\s*(?:November\s+)?\d+):\s*(.+)$/i.exec(evidence);
    const period = match && extractDateRange(match[1], { publishedWeekId: doc.publishedOn, now: new Date(doc.publishedOn) });
    if (period) facts.push({ section:'free-vehicles', entity:match[2], offer:'Reward for playing GTA Online',
      eligibility:'all', platform:'all', startsOn:period.startId, endsOn:period.endId, evidence, dateEvidence:match[1] });
  }
  // Weekly login rewards with an explicit end matching the article's dated
  // week. Other dates (weekends/months) must not inherit this window.
  if (doc.source.scope !== 'membership' && doc.period) {
    const dates = [...doc.text.matchAll(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:[-–—]|to|through)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?/gi)].map(m=>m[0]);
    const dateEvidence = dates.find(d=>periodIsSupported(doc.period.startId, doc.period.endId, d, doc));
    for (const [, html] of doc.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
      const evidence = stripTags(html);
      const reward = /Play GTA Online anytime through ([A-Za-z]+ \d{1,2}) to get (.+?)\./i.exec(evidence);
      const end = reward && Date.parse(`${reward[1]}, ${doc.period.endId.slice(0,4)} UTC`);
      if (dateEvidence && reward && end === Date.parse(doc.period.endId)) facts.push({
        section:'free-vehicles', entity:reward[2], offer:'Reward for playing GTA Online',
        eligibility:'all', platform:'all', startsOn:doc.period.startId, endsOn:doc.period.endId,
        evidence:reward[0], dateEvidence,
      });
    }
  }
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
