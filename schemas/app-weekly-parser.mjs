import { isSeasonalEvent } from './seasonal-event.mjs';
const isString = (v) => typeof v === 'string';
function isWeeklyItem(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const o = v;
    const validTarget = o.targetCount === undefined ||
        (typeof o.targetCount === 'number' && Number.isInteger(o.targetCount) && o.targetCount > 1);
    return isString(o.id) && isString(o.label) && validTarget && validTiming(o) &&
        (o.progressGroup === undefined || ['primary', 'extra', 'gta-plus', 'none'].includes(o.progressGroup)) &&
        (o.progressGroup === 'gta-plus' ? typeof o.progressPeriodId === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.progressPeriodId) : o.progressPeriodId === undefined) &&
        (o.itemIds === undefined || (Array.isArray(o.itemIds) && o.itemIds.every(isString))) &&
        (o.sources === undefined || (Array.isArray(o.sources) && o.sources.every(validCitation))) &&
        (o.videoId === undefined || (isString(o.videoId) && /^[\w-]{11}$/.test(o.videoId))) &&
        (o.offsetMs === undefined || (typeof o.offsetMs === 'number' && Number.isFinite(o.offsetMs) && o.offsetMs >= 0));
}
function isWeeklySection(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const o = v;
    return isString(o.id) && isString(o.title) && Array.isArray(o.items) && o.items.every(isWeeklyItem);
}
function isWeeklyLocation(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const o = v;
    return isString(o.id) && isString(o.activity) && isString(o.name) && isString(o.area) && validTiming(o);
}
function validTiming(o) {
    const valid = (v) => v === undefined || (isString(v) && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
    return valid(o.startsAt) && valid(o.expiresAt) &&
        (!isString(o.startsAt) || !isString(o.expiresAt) || Date.parse(o.startsAt) < Date.parse(o.expiresAt));
}
function validCitation(v) {
    if (!v || typeof v !== 'object')
        return false;
    const o = v;
    if (!isString(o.url) || !isString(o.kind))
        return false;
    try {
        const u = new URL(o.url);
        return u.protocol === 'https:' && !u.username && !u.password &&
            ['www.rockstargames.com', 'rockstarintel.com', 'www.gtabase.com', 'www.youtube.com'].includes(u.hostname);
    }
    catch {
        return false;
    }
}
/** Validates untrusted JSON (remote fetch / cache) before it reaches the UI. */
export function parseWeeklyContent(v) {
    if (typeof v !== 'object' || v === null)
        return null;
    const o = v;
    const valid = (o.seasonalEvent === undefined || isSeasonalEvent(o.seasonalEvent)) &&
        isString(o.weekId) && /^\d{4}-\d{2}-\d{2}$/.test(o.weekId) && Number.isFinite(Date.parse(o.weekId)) && validTiming(o) &&
        (o.schemaVersion === undefined || o.schemaVersion === 2) &&
        (o.schemaVersion !== 2 || (isString(o.startsAt) && isString(o.expiresAt))) &&
        (o.sources === undefined || (Array.isArray(o.sources) && o.sources.every(validCitation))) &&
        (o.quickTakeEntries === undefined || (Array.isArray(o.quickTakeEntries) && o.quickTakeEntries.every(isWeeklyItem))) &&
        isString(o.range) &&
        isString(o.headline) &&
        Array.isArray(o.quickTake) &&
        o.quickTake.every(isString) &&
        Array.isArray(o.sections) &&
        o.sections.every(isWeeklySection) &&
        Array.isArray(o.beginnerPath) &&
        o.beginnerPath.every(isWeeklyItem) &&
        (o.locations === undefined || (Array.isArray(o.locations) && o.locations.every(isWeeklyLocation)));
    return valid ? v : null;
}
