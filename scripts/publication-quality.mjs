import { readFileSync } from 'node:fs';

export const memberPeriods = JSON.parse(readFileSync(new URL('../events/gta-plus.json', import.meta.url), 'utf8'));
export const weeklyRequirements = JSON.parse(readFileSync(new URL('../events/weekly-quality.json', import.meta.url), 'utf8'));
export class PublicationQualityError extends Error {}

const dayId = now => now.toISOString().slice(0, 10);
const overlapsWeek = (content, period) => {
  const end = new Date(`${content.weekId}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return content.weekId <= period.endsOn && dayId(end) >= period.startsOn;
};
const activePeriod = now => memberPeriods.find(p => p.startsOn <= dayId(now) && dayId(now) <= p.endsOn);

export function validateMemberPeriods(periods) {
  const ids = new Set();
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!Array.isArray(periods) || !periods.length) throw new PublicationQualityError('GTA+ periods are missing');
  for (const [index, period] of periods.entries()) {
    if (!validDate(period.startsOn) || !validDate(period.endsOn) || period.startsOn > period.endsOn ||
        (index > 0 && periods[index - 1].endsOn >= period.startsOn) ||
        !validDate(period.verifiedOn) || !/^https:\/\/www\.rockstargames\.com\/newswire\/article\//.test(period.sourceUrl) ||
        !Array.isArray(period.items) || !period.items.length) {
      throw new PublicationQualityError('Invalid or overlapping verified GTA+ period');
    }
    for (const item of period.items) {
      if (typeof item.id !== 'string' || !item.id.startsWith('gta-plus-') || ids.has(item.id) ||
          typeof item.label !== 'string' || !item.label.trim() || !['gold', 'limited'].includes(item.tag)) {
        throw new PublicationQualityError('Invalid or duplicate GTA+ item');
      }
      ids.add(item.id);
    }
  }
}
validateMemberPeriods(memberPeriods);

/** A new membership period must be verified; never silently publish without it. */
export function requireMemberPeriod(now = new Date()) {
  if (!activePeriod(now)) throw new PublicationQualityError(`No verified GTA+ benefits for ${dayId(now)}. Update events/gta-plus.json from Rockstar before publishing.`);
}

export function applyMemberBenefits(content, now = new Date()) {
  const result = structuredClone(content);
  result.sections = result.sections.filter(s => s.id !== 'gta-plus');
  const period = activePeriod(now);
  if (period && overlapsWeek(result, period)) {
    result.sections.push({
      id: 'gta-plus',
      title: `GTA+ only — through ${period.endsOn}`,
      items: period.items.map(item => ({ ...item, label: `GTA+ only: ${item.label} — through ${period.endsOn}` })),
    });
  }
  // Explain claiming and eligibility without changing the scraped item's saved-progress id.
  if (result.weekId === '2026-09-03') {
    const office = result.sections.find(s => s.id === 'discounts')?.items
      .find(i => i.id === 'arcadius-business-center-executive-office-free');
    if (office) {
      office.label = 'Arcadius Business Center Executive Office — FREE for all players (no GTA+ required). Claim via Dynasty 8 Executive by September 9; upgrades are separate.';
      const highlight = 'Claim the FREE Arcadius Executive Office via Dynasty 8 Executive by September 9 — no GTA+ required.';
      result.quickTake = [highlight, ...result.quickTake.filter(line => line !== highlight)].slice(0, 4);
    }
    const cyclone = result.sections.find(s => s.id === 'discounts')?.items.find(i => i.id === 'coil-cyclone-ii-70-off');
    if (cyclone) cyclone.label = 'Coil Cyclone II - 70% off (PS5, Xbox Series X|S and PC Enhanced)';
  }
  return result;
}

/** Semantic checks apply to publication, not the archive's historical schema. */
export function validatePublication(content, now = new Date()) {
  if (content.weekId < '2026-09-03') return;
  const section = id => content.sections.find(s => s.id === id);
  for (const id of ['bonuses', 'challenge', 'free-vehicles', 'discounts', 'gun-van', 'other']) {
    if (!section(id)?.items.length) throw new PublicationQualityError(`Publication incomplete: ${id} is empty`);
  }
  for (const requirement of weeklyRequirements[content.weekId] || []) {
    const labels = section(requirement.section)?.items.map(i => i.label).join('\n') || '';
    if (!new RegExp(requirement.pattern, 'i').test(labels)) {
      throw new PublicationQualityError(`Publication missing ${requirement.description}`);
    }
  }
  const period = activePeriod(now);
  const expected = applyMemberBenefits(content, now).sections.find(s => s.id === 'gta-plus');
  if (period && overlapsWeek(content, period)) {
    if (JSON.stringify(section('gta-plus')) !== JSON.stringify(expected)) {
      throw new PublicationQualityError('Publication missing or incorrect dated GTA+ benefits');
    }
  } else if (section('gta-plus')) {
    throw new PublicationQualityError('Publication contains expired or unrelated GTA+ benefits');
  }
}

export function assertPublishedContent(actual, expected, now = new Date()) {
  validatePublication(actual, now);
  // Compare the complete published payload, not only its date or item counts.
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new PublicationQualityError('Live weekly JSON differs from the validated publication artifact');
  }
}
