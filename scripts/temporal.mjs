// Portable contract: this file is copied verbatim into the app by sync-temporal.mjs.
export const ZONE = 'Europe/Warsaw';
export const MINUTE = 60_000;
export const DAY = 86_400_000;
export function localParts(time, timeZone = ZONE) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time)).map(v => [v.type, v.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
export function addDays(date, days) { return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10); }
export function validDay(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export function atLocal(date, minutes, timeZone = ZONE) {
  if (!validDay(date) || !Number.isInteger(minutes) || minutes < 0 || minutes >= 1440) throw new Error('invalid_local_time');
  const target = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE;
  let guess = target;
  for (let n = 0; n < 4; n++) {
    const p = localParts(guess, timeZone);
    const delta = target - (Date.parse(`${p.date}T00:00:00Z`) + p.minutes * MINUTE);
    if (!delta) return guess;
    guess += delta;
  }
  throw new Error('nonexistent_local_time');
}
export const TIMING_POLICY_VERSION = 1;
export function isWeeklyPeriod(startsOn, endsOn) {
  return validDay(startsOn) && new Date(`${startsOn}T12:00:00Z`).getUTCDay() === 4 && endsOn === addDays(startsOn, 6);
}
export function windowFromDays(startsOn, endsOn, weeklyReset = isWeeklyPeriod(startsOn, endsOn)) {
  if (!validDay(startsOn) || !validDay(endsOn) || endsOn < startsOn) throw new Error('invalid_period');
  return {
    startsAt: new Date(atLocal(startsOn, 11 * 60)).toISOString(),
    expiresAt: new Date(atLocal(addDays(endsOn, 1), weeklyReset ? 11 * 60 : 0)).toISOString(),
    originalZone: ZONE, precision: 'date',
    timingConfidence: 'estimated',
  };
}
// Idempotent repair of schema-v2 caches written with the old midnight default.
// Exact source times, membership periods and shorter events keep their own clocks.
export function normalizeWeeklyTiming(input) {
  const c = JSON.parse(JSON.stringify(input));
  const visit = (v, membership = false) => {
    if (!v || typeof v !== 'object') return;
    membership ||= v.windowPolicy === 'independent' || v.id === 'gta-plus' || (v.sources?.length > 0 && v.sources.every(s => s.scope === 'membership'));
    if (!membership && v.originalZone === ZONE && v.timingConfidence === 'estimated' && v.precision === 'date' &&
        Number.isFinite(Date.parse(v.startsAt)) && Number.isFinite(Date.parse(v.expiresAt))) {
      const start = localParts(v.startsAt), end = localParts(v.expiresAt);
      if (start.minutes === 660 && end.minutes === 0 && isWeeklyPeriod(start.date, addDays(end.date, -1))) {
        v.expiresAt = new Date(atLocal(end.date, 660)).toISOString();
      }
    }
    for (const [key, value] of Object.entries(v)) if (value && typeof value === 'object') visit(value, membership || key === 'vehicleReward');
  };
  visit(c);
  return c;
}
export function activeAt(item, now) {
  return (!item.startsAt || Date.parse(item.startsAt) <= now) && (!item.expiresAt || now < Date.parse(item.expiresAt));
}
export function boundaryTimes(content) {
  const values = [];
  const visit = v => {
    if (!v || typeof v !== 'object') return;
    for (const [key, value] of Object.entries(v)) {
      if (['startsAt', 'expiresAt'].includes(key) && typeof value === 'string' && Number.isFinite(Date.parse(value))) values.push(Date.parse(value));
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(content);
  return [...new Set(values)].sort((a, b) => a - b);
}
export function legacyWindow(content) {
  // Legacy bundled/cache records never stay active indefinitely.
  return windowFromDays(content.weekId, addDays(content.weekId, 6));
}
export function projectContent(input, now = Date.now()) {
  const c = normalizeWeeklyTiming(input); // JSON contract works in Hermes without structuredClone.
  const w = c.schemaVersion === 2 ? c : { ...legacyWindow(c), ...c };
  const periodActive = activeAt(w, now);
  const live = item => activeAt({ startsAt: w.startsAt, expiresAt: w.expiresAt, ...item }, now);
  c.sections = c.sections.map(s => {
    const items = s.items.filter(live);
    return { ...s, items, completeness: items.length ? (s.completeness || 'partial') : 'pending' };
  });
  const liveIds = new Set(c.sections.flatMap(s => s.items.map(i => i.id)));
  const dependent = i => live(i) && (!i.itemIds || i.itemIds.every(id => liveIds.has(id)));
  c.beginnerPath = c.beginnerPath.filter(dependent);
  c.locations = (c.locations || []).filter(dependent);
  if (c.quickTakeEntries) c.quickTake = c.quickTakeEntries.filter(dependent).map(e => e.label);
  else if (!periodActive || c.schemaVersion === 2) c.quickTake = [];
  if (!periodActive) c.headline = 'New event details are being checked';
  c.completeness = c.sections.some(s => s.completeness === 'pending') ? 'partial' : (c.completeness || 'partial');
  if (c.seasonalEvent) {
    const e = c.seasonalEvent;
    e.weeks = e.weeks.map(week => {
      const timing = { ...windowFromDays(week.startsOn, week.endsOn), ...week };
      return { ...timing, status: now < Date.parse(timing.startsAt) ? 'Upcoming' : now >= Date.parse(timing.expiresAt) ? 'Ended' : 'This week' };
    });
    e.vehicleReward.qualifyWindow = windowFromDays(e.vehicleReward.qualifyFrom, e.vehicleReward.qualifyUntil, false);
    e.vehicleReward.claimWindow = windowFromDays(e.vehicleReward.claimFrom, e.vehicleReward.claimUntil, false);
    const expires = e.expiresAt || new Date(atLocal(addDays(e.endsOn, 1), 0)).toISOString();
    if (now >= Date.parse(expires)) delete c.seasonalEvent;
  }
  const next = boundaryTimes(w).find(t => t > now);
  c.nextBoundaryAt = next ? new Date(next).toISOString() : null;
  return c;
}

export function nextCheck(now, events = [], pending = false) {
  const day = localParts(now).date;
  const candidates = [];
  for (let offset = 0; offset < 8; offset++) {
    const date = addDays(day, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const eventDay = events.some(e => localParts(e.at).date === date);
    const intensive = [2, 3, 4].includes(weekday) || eventDay || pending;
    if (weekday === 3) {
      const at = atLocal(date, 19 * 60);
      if (at > now) candidates.push({ at, kind: 'check', reason: 'Środowa kontrola o 19:00', confidence: 'confirmed', sourceUrl: null });
    }
    let slots = weekday === 4 ? [...Array.from({ length: 9 }, (_, i) => 480 + i * 30), 650] :
      intensive ? Array.from({ length: 14 }, (_, i) => 530 + i * 15) : [650, 890, 1130];
    if (pending && intensive) slots.push(...Array.from({ length: 10 }, (_, i) => 785 + i * 60));
    if (date === '2026-09-16') {
      slots = slots.filter(m => m < 17 * 60 || m > 20 * 60 + 59);
      slots.push(17 * 60, 18 * 60, 19 * 60, 20 * 60);
    }
    for (const minute of new Set(slots)) {
      const at = atLocal(date, minute);
      if (at > now) candidates.push({ at, kind: 'check', reason: intensive ? 'Kontrola dnia zmian' : 'Kontrola zapobiegawcza', confidence: 'estimated', sourceUrl: null });
    }
  }
  for (const e of events) {
    if (e.at > now) candidates.push(e);
    if (e.kind === 'start' && e.at - 10 * MINUTE > now) candidates.push({ ...e, at: e.at - 10 * MINUTE, kind: 'prepare', reason: `Przygotowanie: ${e.reason}` });
  }
  return candidates.sort((a, b) => a.at - b.at)[0];
}
export function collectEvents(content, previous = [], now = Date.now()) {
  const events = new Map(previous.filter(e => e.at > now).map(e => [e.key, e]));
  const visit = (v, path) => {
    if (!v || typeof v !== 'object') return;
    for (const field of ['startsAt', 'expiresAt']) {
      const at = Date.parse(v[field]);
      if (Number.isFinite(at) && at > now) {
        const key = `${path}:${field}:${at}`;
        events.set(key, { key, at, kind: field === 'startsAt' ? 'start' : 'expire',
          reason: v.label || v.title || `${path} ${field}`, sourceUrl: v.sourceUrl || content.sourceUrl || null,
          confidence: v.timingConfidence || 'estimated', originalZone: v.originalZone || ZONE });
      }
    }
    for (const [key, child] of Object.entries(v)) if (child && typeof child === 'object') visit(child, `${path}/${child.id || key}`);
  };
  visit(content, content.weekId);
  const event = content.seasonalEvent;
  if (event) {
    for (const [id, w] of [...event.weeks.map(w => [w.startsOn, w]), ['qualify', { startsOn: event.vehicleReward.qualifyFrom, endsOn: event.vehicleReward.qualifyUntil }], ['claim', { startsOn: event.vehicleReward.claimFrom, endsOn: event.vehicleReward.claimUntil }]]) {
      visit({ ...windowFromDays(w.startsOn, w.endsOn, !['qualify', 'claim'].includes(id) && isWeeklyPeriod(w.startsOn, w.endsOn)), label: `${event.title}: ${id}`, sourceUrl: event.sourceUrl }, `${event.id}/${id}`);
    }
  }
  return [...events.values()].sort((a, b) => a.at - b.at);
}
