import { readFileSync } from 'node:fs';

export const septemberEvent = JSON.parse(readFileSync(
  new URL('../events/business-rivalries-2026-09.json', import.meta.url), 'utf8',
));

export const isRetiredDlcAnnouncement = (line) =>
  /^NEW DLC:\s*The Kortz Center Heist is live\b/i.test(line.trim());

const text = (v) => typeof v === 'string' && v.trim().length > 0;
const date = (v) => text(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const period = (v) => v && date(v.startsOn) && date(v.endsOn) && v.startsOn <= v.endsOn;

export function isSeasonalEvent(v) {
  if (!period(v) || !['id', 'title', 'summary', 'description'].every(k => text(v[k]))) return false;
  try { if (new URL(v.sourceUrl).protocol !== 'https:') return false; } catch { return false; }
  if (!Array.isArray(v.weeks) || v.weeks.length === 0) return false;
  if (!v.weeks.every((w, i) => period(w) && w.startsOn >= v.startsOn && w.endsOn <= v.endsOn &&
    (i === 0 || v.weeks[i - 1].endsOn < w.startsOn) &&
    ['challenge', 'reward', 'outfit'].every(k => text(w[k])) &&
    (w.targetCount === undefined || (Number.isInteger(w.targetCount) && w.targetCount > 1)))) return false;
  const car = v.vehicleReward;
  return !!car && ['name', 'description', 'upgrade'].every(k => text(car[k])) &&
    ['qualifyFrom', 'qualifyUntil', 'claimFrom', 'claimUntil'].every(k => date(car[k])) &&
    v.startsOn <= car.qualifyFrom && car.qualifyFrom <= car.qualifyUntil &&
    car.qualifyUntil < car.claimFrom && car.claimFrom <= car.claimUntil && car.claimUntil <= v.endsOn;
}

/** Apply after source selection, including when richer existing content wins. */
export function applySeasonalContent(content, now = new Date()) {
  const result = structuredClone(content);
  result.quickTake = result.quickTake.filter(line => !isRetiredDlcAnnouncement(line));
  const today = now.toISOString().slice(0, 10);
  const event = septemberEvent;
  const week = event.weeks.find(w => w.startsOn === result.weekId);
  if (week && today >= event.startsOn && today <= event.endsOn) {
    result.seasonalEvent = structuredClone(event);
    const section = result.sections.find(s => s.id === 'challenge');
    if (section) {
      section.items = [{
        // Preserve the published first-week id and its saved progress.
        id: result.weekId === '2026-09-03'
          ? 'the-gta-online-weekly-challenge-for-this-week-is'
          : `business-rivalries-${result.weekId}`,
        label: `${week.challenge} to receive an extra ${week.reward} and the ${week.outfit}.`,
        tag: 'gold',
        ...(week.targetCount ? { targetCount: week.targetCount } : {}),
      }];
    }
  } else if (result.seasonalEvent?.id === event.id) {
    delete result.seasonalEvent;
  }
  return result;
}
