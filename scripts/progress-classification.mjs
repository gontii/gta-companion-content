/** Progress is editorial data derived from corroborated/official facts, never inferred by the app. */
export const PROGRESS_GROUPS = ['primary', 'extra', 'gta-plus', 'none'];
const verified = item => ['official', 'corroborated'].includes(item.confidence) ||
  (item.confidence === 'editorial' && item.sources?.some(s => s.kind === 'rockstar'));
const rewardAmount = offer => {
  // Only a guaranteed reward after an action; required sales and possible earnings are excluded.
  const reward = offer.match(/(?:receive|earn|reward(?:ed)?|bonus|extra|pays?)\s+(?:an?\s+)?(?:extra\s+)?GTA\$\s*([\d,]+)/i) ||
    offer.match(/(?:receive|earn|reward(?:ed)?|bonus|extra)[^.;]{0,90}?GTA\$\s*([\d,]+)/i);
  return reward ? Number(reward[1].replaceAll(',', '')) : null;
};
export function classifyProgressItem(item, sectionId, weekId) {
  if (!verified(item)) return { progressGroup: 'none' };
  const offer = item.offer || '';
  const label = item.label || '';
  if (item.eligibility === 'gta-plus' || sectionId === 'gta-plus') {
    const monthlyClaim = /\bclaim\b|\bFREE\b[^.;]{0,100}\b(?:at|from|via|in)\b/i.test(offer || label) && !/% off|multiplier|\b[2-9]X\b/i.test(offer || label);
    const weeklyAction = /first weekly completion/i.test(offer || label);
    if (!monthlyClaim && !weeklyAction) return { progressGroup: 'none' };
    return { progressGroup: 'gta-plus', progressPeriodId: weeklyAction ? weekId :
      (item.startsAt?.slice(0, 10) || weekId) };
  }
  // Guaranteed weekly cash objectives also appear alongside other weekly items.
  // A season-wide bonus is informational here; it must not reset as a weekly task.
  const duration = Date.parse(item.expiresAt) - Date.parse(item.startsAt);
  if (sectionId === 'other' && /\bcomplete\b/i.test(offer) && duration >= 6 * 86400000 && duration <= 8 * 86400000) {
    const amount = rewardAmount(offer);
    if (amount !== null) return { progressGroup: amount >= 250_000 ? 'primary' : 'extra' };
  }
  if (sectionId === 'challenge') {
    const amount = rewardAmount(offer);
    if (amount !== null) return { progressGroup: amount >= 250_000 ? 'primary' : 'extra' };
    return /complete|finish|win|place|secure|collect/i.test(offer) ? { progressGroup: 'extra' } : { progressGroup: 'none' };
  }
  if (sectionId === 'free-vehicles' || sectionId === 'gun-van' || sectionId === 'discounts') {
    if (/race|place top|win\s+\d/i.test(offer)) return { progressGroup: 'extra' };
    if (/\bfree\b|\bclaim\b|GTA\$0\b|100% off/i.test(offer) && !/awaits confirmation|unconfirmed/i.test(offer)) return { progressGroup: 'primary' };
  }
  return { progressGroup: 'none' };
}
export function classifyProgressContent(content) {
  for (const section of content.sections) for (const item of section.items) {
    delete item.progressPeriodId;
    Object.assign(item, classifyProgressItem(item, section.id, content.weekId));
  }
  for (const tip of content.beginnerPath || []) {
    const linked = content.sections.flatMap(s => s.items).find(i => i.id === tip.itemIds?.[0] || i.id === tip.id);
    if (linked) {
      tip.itemIds = [linked.id];
      tip.progressGroup = linked.progressGroup;
      if (linked.targetCount) tip.targetCount = linked.targetCount;
      if (linked.progressPeriodId) tip.progressPeriodId = linked.progressPeriodId;
    } else tip.progressGroup = 'none';
  }
  return content;
}
export function validateProgressContent(content) {
  for (const section of content.sections) for (const item of section.items) {
    if (item.progressGroup === undefined) continue; // historical documents
    if (!PROGRESS_GROUPS.includes(item.progressGroup)) throw new Error('invalid_progress_group');
    if (item.progressGroup === 'gta-plus' ? !/^\d{4}-\d{2}-\d{2}$/.test(item.progressPeriodId || '') : item.progressPeriodId !== undefined)
      throw new Error('invalid_progress_period');
    if (item.progressGroup !== 'none' && !verified(item)) throw new Error('unverified_progress_item');
  }
}
