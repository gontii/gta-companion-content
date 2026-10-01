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

/** Calendar dates are UTC, matching the content generator. */
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

export function visibleSeasonalEvent(event, day) {
  return event && day >= event.startsOn && day <= event.endsOn ? event : null;
}

export function seasonalWeekStatus(week, day) {
  return day < week.startsOn ? 'Upcoming' : day > week.endsOn ? 'Ended' : 'This week';
}

export function thisWeekContent(content) {
  return {
    sections: content.sections.filter(section => section.id !== 'dlc'),
    quickTake: content.quickTake.filter(line => !isRetiredDlcAnnouncement(line)),
  };
}
