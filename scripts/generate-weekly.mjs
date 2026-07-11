#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEEKLY_SECTION_IDS = ['bonuses', 'challenge', 'free-vehicles', 'discounts', 'gun-van', 'other'];
const GTABASE_SOURCE_INDEX_URL = 'https://www.gtabase.com/grand-theft-auto-v/news/';
const ROCKSTAR_GRAPHQL_URL = 'https://graph.rockstargames.com?origin=https://www.rockstargames.com';
const ROCKSTAR_GTA_ONLINE_TAG_ID = 702;
const DAY_MS = 86_400_000;
// A GTA week runs Thursday..Wednesday (7 days from the reset).
const WEEK_LENGTH_DAYS = 6;
// Reject sources whose publish date is older than this. Guards against the
// fallback scraper picking up a long-stale article whose low-quality parse would
// otherwise overwrite good content; complements the period-overlap check below.
const DEFAULT_MAX_SOURCE_AGE_DAYS = 7;

const ROCKSTAR_NEWSWIRE_LIST_QUERY = `
query NewswireList($locale: String!, $page: Int!, $limit: Int, $tagId: Int, $metaUrl: String!, $cache: Boolean = true) {
  posts(page: $page, tagId: $tagId, locale: $locale, limit: $limit) {
    results {
      id: id_hash
      url
      title
      name_slug
      created
      created_formatted
      primary_tags { id name }
      secondary_tags { id name }
    }
  }
}
`;

const ROCKSTAR_NEWSWIRE_POST_QUERY = `
query NewswirePost($id_hash: String!, $locale: String!, $cache: Boolean = true) {
  post(id_hash: $id_hash, locale: $locale) {
    id: id_hash
    title
    subtitle
    content
    created
    created_formatted
    posts_jsx { markup variables_us_defaulted }
    tina {
      id
      payload
      variables { keys }
      status
    }
    primary_tags { id name }
    secondary_tags { id name }
  }
}
`;

const SECTION_RULES = [
  { id: 'bonuses', title: 'Best bonuses', patterns: [/bonus/i, /gta\$/i, /\b[2-9]x\b/i, /rp/i] },
  { id: 'challenge', title: 'Weekly challenge', patterns: [/challenge/i, /complete/i, /unlock/i] },
  { id: 'free-vehicles', title: 'Free rewards & prize vehicles', patterns: [/free/i, /reward/i, /vehicle/i, /log in/i] },
  { id: 'discounts', title: 'Discounts & Offers', patterns: [/discount/i, /offer/i, /%/] },
  { id: 'gun-van', title: 'Gun Van', patterns: [/gun van/i, /weapon/i, /stock/i] },
  { id: 'other', title: 'Other weekly items', patterns: [] },
];

function monthName(date) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date);
}

function formatRangeFromDates(start, end) {
  const startMonth = monthName(start);
  const endMonth = monthName(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  return startMonth === endMonth
    ? `${startMonth} ${startDay} - ${endDay}, ${year}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
}

// Fallback used only when the source exposes no explicit date range: assume the
// standard 7-day GTA week starting on weekId.
function formatRange(weekId) {
  const start = new Date(`${weekId}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return formatRangeFromDates(start, end);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
// Maps every full and 3-letter month spelling to its 0-based index.
const MONTH_INDEX = new Map(
  MONTH_NAMES.flatMap((name, index) => [
    [name.toLowerCase(), index],
    [name.slice(0, 3).toLowerCase(), index],
  ]),
);
const MONTH_PATTERN =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
// e.g. "July 9 - 13, 2026", "July 9-13", "July 9 to 13", "July 30 - August 5".
const DATE_RANGE_REGEX = new RegExp(
  `${MONTH_PATTERN}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|through|thru)\\s*(?:${MONTH_PATTERN}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?`,
  'gi',
);
const MAX_WEEK_SPAN_DAYS = 14;

function dayId(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function spanDays(startId, endId) {
  const start = Date.parse(`${startId}T00:00:00Z`);
  const end = Date.parse(`${endId}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return Infinity;
  return (end - start) / DAY_MS;
}

// Turns a single DATE_RANGE_REGEX match into { startId, endId, rangeText },
// inferring a missing year (and Dec->Jan rollover) from the source publish date.
// Returns null when the match is implausible as a GTA week.
function rangeFromMatch(match, publishedWeekId) {
  const startMonth = MONTH_INDEX.get(String(match[1]).slice(0, 3).toLowerCase());
  const startDay = Number(match[2]);
  const endMonth = match[3] != null ? MONTH_INDEX.get(String(match[3]).slice(0, 3).toLowerCase()) : startMonth;
  const endDay = Number(match[4]);
  const parsedYear = match[5] != null ? Number(match[5]) : null;
  if (startMonth == null || endMonth == null) return null;

  const publishedYear = Number(String(publishedWeekId || '').slice(0, 4)) || new Date().getUTCFullYear();
  const publishedMonth = Number(String(publishedWeekId || '').slice(5, 7)) - 1;
  let startYear = parsedYear ?? publishedYear;
  // Article published in January about an event that began the prior December.
  if (parsedYear == null && publishedMonth === 0 && startMonth === 11) startYear -= 1;
  const endYear = endMonth < startMonth ? startYear + 1 : startYear;

  const startId = dayId(startYear, startMonth, startDay);
  const endId = dayId(endYear, endMonth, endDay);
  const span = spanDays(startId, endId);
  if (!(span >= 0 && span <= MAX_WEEK_SPAN_DAYS)) return null;

  const rangeText = formatRangeFromDates(
    new Date(`${startId}T00:00:00Z`),
    new Date(`${endId}T00:00:00Z`),
  );
  return { startId, endId, rangeText };
}

// Reads the real event period straight from the article text. Prefers the
// headline, then scans the body; when several ranges appear it picks the one
// whose start is closest to the current GTA week. Returns null if none found.
function extractDateRange(html, { publishedWeekId, now = new Date() } = {}) {
  let headlineText = '';
  try {
    headlineText = extractHeadline(html);
  } catch {
    headlineText = '';
  }
  const bodyText = stripTags(html);

  const candidates = [];
  for (const text of [headlineText, bodyText]) {
    if (!text) continue;
    for (const match of text.matchAll(DATE_RANGE_REGEX)) {
      const parsed = rangeFromMatch(match, publishedWeekId);
      if (parsed) candidates.push(parsed);
    }
  }
  if (candidates.length === 0) return null;

  const anchor = Date.parse(`${thursdayWeekId(now)}T00:00:00Z`);
  candidates.sort(
    (a, b) =>
      Math.abs(Date.parse(`${a.startId}T00:00:00Z`) - anchor) -
      Math.abs(Date.parse(`${b.startId}T00:00:00Z`) - anchor),
  );
  return candidates[0];
}

export function thursdayWeekId(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay();
  const diff = (day + 3) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/gta\$/g, 'gta')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function stripTags(value) {
  return cleanText(String(value || '').replace(/<[^>]+>/g, ' '));
}

function blockBetween(html, startPattern, endPattern) {
  const start = html.search(startPattern);
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.slice(1).search(endPattern);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function extractListItemsFrom(block) {
  return [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((item) => stripTags(item[1]))
    .filter(Boolean);
}

function extractParagraphItemsFrom(block) {
  return [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((item) => stripTags(item[1]))
    .filter((item) => item && !/^https?:\/\//i.test(item));
}

function extractFieldEntry(html, className) {
  const start = html.search(new RegExp(`<li[^>]+class=["'][^"']*field-entry ${className}\\b`, 'i'));
  if (start < 0) return '';
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<li[^>]+class=["'][^"']*field-entry /i);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

function extractCards(block) {
  return [...block.matchAll(/<li[^>]+class=["'][^"']*gta-bonuses[\s\S]*?<\/li>/gi)]
    .map((match) => {
      const card = match[0];
      const title =
        card.match(/<h3[^>]+class=["'][^"']*contentheading[^"']*["'][\s\S]*?<a[^>]+title=["']([^"']+)["']/i)?.[1] ||
        card.match(/<a[^>]+title=["']([^"']+)["']/i)?.[1];
      if (!title) return null;

      return {
        title: cleanText(title),
        type: stripTags(card.match(/<div[^>]+class=["']item-type["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || ''),
        discount: cleanText(card.match(/<span[^>]+class=["'][^"']*badge new[^"']*["'][^>]*>([^<]+)<\/span>/i)?.[1] || ''),
        cashMultiplier: cleanText(card.match(/<div[^>]+class=["'][^"']*bonus-multiplier cash[^"']*["'][^>]*>([^<]+)<\/div>/i)?.[1] || ''),
        rpMultiplier: cleanText(card.match(/<div[^>]+class=["'][^"']*bonus-multiplier rp[^"']*["'][^>]*>([^<]+)<\/div>/i)?.[1] || ''),
      };
    })
    .filter(Boolean);
}

function extractGtabaseSections(html) {
  if (!/field-entry gta5-bonuses/i.test(html)) return null;

  const fineArtItems = extractListItemsFrom(blockBetween(
    html,
    /<h2[^>]*>\s*Fine Art Collector Program\s*<\/h2>/i,
    /<h2[^>]*>\s*(?:Weekly Challenge|This Week)/i,
  ));
  const challengeItems = extractParagraphItemsFrom(blockBetween(html, /<h2[^>]*>\s*Weekly Challenge\s*<\/h2>/i, /<h2[^>]*>\s*This Week/i));

  const bonusItems = extractCards(extractFieldEntry(html, 'gta5-bonuses')).map((card) => {
    const cash = card.cashMultiplier ? card.cashMultiplier.toUpperCase() : '';
    const rp = card.rpMultiplier ? card.rpMultiplier.toUpperCase() : '';
    const multiplier = cash && rp ? `${cash} GTA$ and RP` : cash ? `${cash} GTA$` : rp ? `${rp} RP` : 'Bonus';
    return `${multiplier} on ${card.title}`;
  });
  bonusItems.push(...extractListItemsFrom(blockBetween(html, /<h3[^>]*>\s*GTA\$\s*&amp;\s*RP also on\s*<\/h3>/i, /<h3[^>]*>\s*Salvage Yard Robberies\s*<\/h3>/i)));

  const discountItems = extractCards(extractFieldEntry(html, 'gta5-discounts')).map((card) => {
    const discount = card.discount.replace(/^-/, '');
    return discount ? `${discount} off ${card.title}` : card.title;
  });

  const showroomCards = extractCards(extractFieldEntry(html, 'showrooms-test-rides'));
  const freeVehicleItems = [
    ...fineArtItems,
    ...showroomCards
      .filter((card) => /podium|prize/i.test(card.type))
      .map((card) => `${card.type}: ${card.title}`),
  ];
  const showroomItems = showroomCards
    .filter((card) => !/podium|prize/i.test(card.type))
    .map((card) => `${card.type}: ${card.title}`);

  const otherItems = [
    ...showroomItems,
    ...extractListItemsFrom(blockBetween(html, /<h3[^>]*>\s*Salvage Yard Robberies\s*<\/h3>/i, /<h3[^>]*>\s*Premium Race/i)),
    ...extractListItemsFrom(blockBetween(html, /<h3[^>]*>\s*Premium Race\s*&amp;\s*Trials\s*<\/h3>/i, /<h3[^>]*>\s*GUN VAN/i)),
  ];
  const gunVanItems = extractListItemsFrom(blockBetween(html, /<h3[^>]*>\s*GUN VAN Primary Discounts\s*<\/h3>/i, /<\/div>\s*<section/i));

  return [
    { heading: 'Bonuses', items: bonusItems },
    { heading: 'Weekly Challenge', items: challengeItems },
    { heading: 'Free rewards and prize vehicles', items: freeVehicleItems },
    { heading: 'Discounts', items: discountItems },
    { heading: 'Gun Van', items: gunVanItems },
    { heading: 'Other weekly items', items: otherItems },
  ].filter((section) => section.items.length > 0);
}

function absoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export function findWeeklySourceUrl(indexHtml, { baseUrl = GTABASE_SOURCE_INDEX_URL } = {}) {
  const links = [...String(indexHtml || '').matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set();

  for (const link of links) {
    const href = cleanText(link[1]);
    const label = stripTags(link[2]);
    const combined = `${href} ${label}`;
    if (!/gta-online-weekly-update/i.test(combined)) continue;

    const url = absoluteUrl(href, baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    return url;
  }

  return null;
}

function extractPublishedWeekId(html) {
  const metaMatch =
    html.match(/<meta[^>]+(?:property|name)=["'](?:article:published_time|datePublished|publishedTime)["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/"(?:datePublished|publishedTime)"\s*:\s*"([^"]+)"/i);
  if (!metaMatch) return null;
  const timestamp = Date.parse(cleanText(metaMatch[1]));
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sourceAgeDays(publishedDateId, now) {
  const published = Date.parse(`${publishedDateId}T00:00:00Z`);
  const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(published)) return Infinity;
  return (current - published) / DAY_MS;
}

function extractHeadline(html) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return stripTags(h1[1]);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripTags(title[1]).replace(/\s+-\s+Rockstar Games.*$/i, '');
  throw new Error('Could not find a weekly headline in the source');
}

function extractSectionItems(html) {
  const gtabaseSections = extractGtabaseSections(html);
  if (gtabaseSections) return gtabaseSections;

  const matches = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*?)(?=<h2[^>]*>|<\/article>|<\/body>|$)/gi)];
  const sections = [];

  for (const match of matches) {
    const heading = stripTags(match[1]);
    const body = match[2];
    const items = [...body.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((item) => stripTags(item[1]))
      .filter(Boolean);
    if (heading && items.length > 0) sections.push({ heading, items });
  }

  if (sections.length === 0) {
    const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
      .map((item) => stripTags(item[1]))
      .filter(Boolean);
    if (items.length > 0) sections.push({ heading: 'Bonuses', items });
  }

  return sections;
}

function ruleForHeading(heading) {
  return SECTION_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(heading))) || SECTION_RULES.at(-1);
}

function tagFor(label) {
  if (/\b[2-9]x\b|gta\$1,000,000|gta\$500,000/i.test(label)) return 'gold';
  if (/free|log in|unlock|through|limited/i.test(label)) return 'limited';
  return undefined;
}

function targetCountFor(label) {
  const countMatch = label.match(/\b(?:complete|finishing|finish|all)\s+(?:all\s+)?([2-9])\b/i);
  if (!countMatch) return undefined;
  return Number(countMatch[1]);
}

function itemFromLabel(sectionId, label, usedIds) {
  const base = slug(label) || `${sectionId}-item`;
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(id);

  const item = { id, label };
  const tag = tagFor(label);
  if (tag) item.tag = tag;
  const targetCount = targetCountFor(label);
  if (targetCount) item.targetCount = targetCount;
  return item;
}

function normalizeSections(rawSections) {
  const buckets = new Map(SECTION_RULES.map((rule) => [rule.id, { id: rule.id, title: rule.title, items: [] }]));
  const usedIds = new Set();

  for (const raw of rawSections) {
    const rule = ruleForHeading(raw.heading);
    const bucket = buckets.get(rule.id);
    for (const label of raw.items) {
      bucket.items.push(itemFromLabel(rule.id, label, usedIds));
    }
  }

  return WEEKLY_SECTION_IDS.map((id) => buckets.get(id));
}

function beginnerPathFrom(sections) {
  const topItems = sections.flatMap((section) => section.items).slice(0, 3);
  if (topItems.length < 3) throw new Error('Weekly source did not provide enough items for beginnerPath');
  return topItems.map((item, index) => ({
    id: `bp-${index + 1}`,
    label: index === 0 ? `Start with ${item.label}.` : item.label,
  }));
}

function locationsFrom(sections) {
  return sections.filter((section) => section.items.length > 0).slice(0, 3).map((section) => ({
    id: `loc-${section.id}`,
    activity: section.items[0].label,
    name: section.title,
    area: 'Los Santos',
    note: 'Check the in-game map, phone, or pause menu for the current entry point.',
  }));
}

export function validateContent(content) {
  const ids = new Set();
  const requireString = (value, field) => {
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} is required`);
  };

  requireString(content.weekId, 'weekId');
  requireString(content.range, 'range');
  requireString(content.headline, 'headline');
  if (!Array.isArray(content.quickTake) || content.quickTake.length < 3) {
    throw new Error('quickTake must contain at least 3 items');
  }
  if (!Array.isArray(content.sections) || content.sections.length !== WEEKLY_SECTION_IDS.length) {
    throw new Error(`sections must contain exactly ${WEEKLY_SECTION_IDS.length} sections`);
  }
  const sectionIds = content.sections.map((section) => section.id);
  if (sectionIds.join(',') !== WEEKLY_SECTION_IDS.join(',')) {
    throw new Error(`sections must use ids in order: ${WEEKLY_SECTION_IDS.join(', ')}`);
  }
  for (const section of content.sections) {
    requireString(section.id, 'section.id');
    requireString(section.title, 'section.title');
    if (!Array.isArray(section.items)) throw new Error(`section ${section.id} has invalid items`);
    for (const item of section.items) {
      requireString(item.id, 'item.id');
      requireString(item.label, 'item.label');
      if (
        item.targetCount !== undefined &&
        (!Number.isInteger(item.targetCount) || item.targetCount <= 1)
      ) {
        throw new Error(`item.targetCount must be an integer greater than 1: ${item.id}`);
      }
      if (ids.has(item.id)) throw new Error(`duplicate item id: ${item.id}`);
      ids.add(item.id);
    }
  }
  if (!Array.isArray(content.beginnerPath) || content.beginnerPath.length < 3) {
    throw new Error('beginnerPath must contain at least 3 items');
  }
}

function shiftDayId(id, days) {
  const ms = Date.parse(`${id}T00:00:00Z`);
  if (!Number.isFinite(ms)) return id;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

// True when [periodStartId, periodEndId] intersects the current GTA week
// (the Thursday reset through the following Wednesday).
function periodOverlapsCurrentWeek(periodStartId, periodEndId, now = new Date()) {
  const weekStartMs = Date.parse(`${thursdayWeekId(now)}T00:00:00Z`);
  const weekEndMs = weekStartMs + WEEK_LENGTH_DAYS * DAY_MS;
  const startMs = Date.parse(`${periodStartId}T00:00:00Z`);
  const endMs = Date.parse(`${periodEndId}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return !(startMs > weekEndMs || endMs < weekStartMs);
}

// Whether already-published weekly content still covers the current GTA week, so
// a run that finds no fresh source can keep it instead of failing. The end date
// is recovered from the stored range text, falling back to a 7-day window.
export function weeklyIsCurrent(content, now = new Date()) {
  if (!content || typeof content.weekId !== 'string') return false;
  const parsed = extractDateRange(content.range || '', { publishedWeekId: content.weekId, now });
  const startId = parsed?.startId || content.weekId;
  const endId = parsed?.endId || shiftDayId(content.weekId, WEEK_LENGTH_DAYS);
  return periodOverlapsCurrentWeek(startId, endId, now);
}

export function buildWeeklyContent(html, options = {}) {
  const now = options.now || new Date();
  const publishedWeekId = extractPublishedWeekId(html);
  if (!publishedWeekId) {
    throw new Error('Source does not expose a parseable published date');
  }
  // The event's stated start date is a more reliable weekId than the article's
  // publish date; fall back to the publish date when no range is stated.
  const parsedRange = extractDateRange(html, { publishedWeekId, now });
  const expectedWeekId = options.weekId || parsedRange?.startId || publishedWeekId;
  if (options.weekId && publishedWeekId !== expectedWeekId) {
    throw new Error(`Source is not the requested weekly update. Expected ${expectedWeekId}, got ${publishedWeekId}`);
  }
  const maxSourceAgeDays = options.maxSourceAgeDays ?? DEFAULT_MAX_SOURCE_AGE_DAYS;
  if (!options.weekId && sourceAgeDays(publishedWeekId, now) > maxSourceAgeDays) {
    throw new Error(`Source is not recent enough. Expected within ${maxSourceAgeDays} days, got ${publishedWeekId}`);
  }
  // The described period must overlap the current GTA week (Thursday..Wednesday).
  // This rejects stale articles whose period already ended and premature previews
  // of a future week, while still accepting mid-week events that begin after the
  // Thursday reset — important now that the job runs every day, not just Thursday.
  if (!options.weekId) {
    const periodStart = parsedRange?.startId || expectedWeekId;
    const periodEnd = parsedRange?.endId || shiftDayId(expectedWeekId, WEEK_LENGTH_DAYS);
    if (!periodOverlapsCurrentWeek(periodStart, periodEnd, now)) {
      throw new Error(`Source period ${expectedWeekId} does not overlap the current GTA week ${thursdayWeekId(now)}`);
    }
  }

  const sections = normalizeSections(extractSectionItems(html));
  // Prefer the exact range parsed from the source; fall back to the 7-day
  // assumption only when the source stated no range for this weekId.
  const range =
    parsedRange && parsedRange.startId === expectedWeekId ? parsedRange.rangeText : formatRange(expectedWeekId);
  const content = {
    weekId: expectedWeekId,
    range,
    headline: extractHeadline(html),
    quickTake: sections.flatMap((section) => section.items.map((item) => item.label)).slice(0, 4),
    sections,
    beginnerPath: beginnerPathFrom(sections),
    locations: locationsFrom(sections),
    sourceUrl: options.sourceUrl || null,
    generatedAt: now.toISOString(),
  };

  validateContent(content);
  return content;
}

function withoutGeneratedAt(content) {
  const clone = structuredClone(content);
  delete clone.generatedAt;
  return clone;
}

async function readExistingWeeklyContent(weeklyDir, weekId) {
  const candidates = [path.join(weeklyDir, `${weekId}.json`), path.join(weeklyDir, 'latest.json')];
  for (const candidate of candidates) {
    try {
      const content = JSON.parse(await readFile(candidate, 'utf8'));
      if (content.weekId === weekId) return content;
    } catch {
      // Missing or invalid existing files should not block generating fresh content.
    }
  }
  return null;
}

async function readLatestWeekly(weeklyDir) {
  try {
    return JSON.parse(await readFile(path.join(weeklyDir, 'latest.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function generateWeeklyFiles({ html, outputDir = '.', now = new Date(), sourceUrl = null } = {}) {
  const content = buildWeeklyContent(html, { now, sourceUrl });
  const weeklyDir = path.join(outputDir, 'weekly');
  await mkdir(weeklyDir, { recursive: true });

  // Never let a regenerated (possibly stale) source downgrade what is already
  // published: refuse to overwrite latest.json with an older weekId. weekIds are
  // ISO dates, so a string comparison is a chronological one.
  const currentLatest = await readLatestWeekly(weeklyDir);
  if (currentLatest?.weekId && currentLatest.weekId > content.weekId) {
    throw new Error(
      `Refusing to overwrite newer published week ${currentLatest.weekId} with older ${content.weekId}`,
    );
  }

  const existingContent = await readExistingWeeklyContent(weeklyDir, content.weekId);
  if (
    existingContent?.generatedAt &&
    JSON.stringify(withoutGeneratedAt(existingContent)) === JSON.stringify(withoutGeneratedAt(content))
  ) {
    content.generatedAt = existingContent.generatedAt;
  }

  const serialized = `${JSON.stringify(content, null, 2)}\n`;
  await writeFile(path.join(weeklyDir, `${content.weekId}.json`), serialized);
  await writeFile(path.join(weeklyDir, 'latest.json'), serialized);
  return { weekId: content.weekId, content };
}

export async function generateFirstValidWeeklyFiles(sources, options = {}) {
  const failures = [];
  for (const source of sources) {
    try {
      const result = await generateWeeklyFiles({ ...options, ...source });
      return { ...result, sourceUrl: source.sourceUrl };
    } catch (error) {
      failures.push(`${source.sourceUrl || 'unknown source'}: ${error.message}`);
    }
  }
  throw new Error(`No valid weekly source found. ${failures.join(' | ')}`);
}

async function readSource(sourceUrl) {
  if (!sourceUrl) throw new Error('Set GTA_WEEKLY_SOURCE_URL or pass --source-url');
  if (sourceUrl.startsWith('file://')) return readFile(fileURLToPath(sourceUrl), 'utf8');
  const response = await fetch(sourceUrl, { headers: { 'user-agent': 'gta-companion-content-bot/1.0' } });
  if (!response.ok) throw new Error(`Could not fetch source ${sourceUrl}: HTTP ${response.status}`);
  return response.text();
}

async function fetchRockstarGraphql(query, variables, fetchImpl = fetch) {
  const url = new URL(ROCKSTAR_GRAPHQL_URL);
  url.searchParams.set('operationName', query.includes('NewswirePost') ? 'NewswirePost' : 'NewswireList');
  url.searchParams.set('variables', JSON.stringify(variables));
  url.searchParams.set('query', query);
  const response = await fetchImpl(url, { headers: { 'user-agent': 'gta-companion-content-bot/1.0' } });
  if (!response.ok) throw new Error(`Could not fetch Rockstar Newswire GraphQL: HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors) throw new Error(`Rockstar Newswire GraphQL returned errors: ${JSON.stringify(body.errors)}`);
  return body.data;
}

function postTags(post) {
  return [...(post?.primary_tags || []), ...(post?.secondary_tags || [])];
}

export function findRockstarNewswirePost(posts) {
  return (posts || []).find((post) =>
    postTags(post).some((tag) => Number(tag.id) === ROCKSTAR_GTA_ONLINE_TAG_ID || tag.name === 'GTA Online'),
  ) || null;
}

function parseRockstarCreated(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let [, month, day, year, hour, minute, meridiem] = match;
  year = Number(year) < 100 ? `20${year}` : year;
  hour = Number(hour);
  if (/pm/i.test(meridiem) && hour !== 12) hour += 12;
  if (/am/i.test(meridiem) && hour === 12) hour = 0;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${minute}:00Z`;
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rockstarValueToHtml(value) {
  if (!value || typeof value !== 'object') return [];
  const parts = [];
  for (const key of ['title', 'headline', 'heading']) {
    if (typeof value[key] === 'string' && value[key].trim()) parts.push(`<h2>${escapeHtml(value[key])}</h2>`);
  }
  for (const key of ['content', 'text', 'description']) {
    if (typeof value[key] === 'string' && value[key].trim()) parts.push(value[key]);
  }
  return parts;
}

export function rockstarPostToHtml(post, sourceUrl) {
  const created = parseRockstarCreated(post?.created) || `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  const keys = post?.tina?.payload?.variables?.keys || post?.tina?.variables?.keys || {};
  const meta = post?.tina?.payload?.meta || {};
  const bodyParts = [
    meta.blurb ? `<p>${escapeHtml(meta.blurb)}</p>` : '',
    post?.subtitle ? `<p>${escapeHtml(post.subtitle)}</p>` : '',
    post?.content || '',
    post?.posts_jsx?.markup || '',
    ...Object.values(keys).flatMap(rockstarValueToHtml),
  ].filter(Boolean);

  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(post?.title || 'Rockstar Newswire')}</title>
    <meta name="article:published_time" content="${created}">
  </head>
  <body>
    <article data-source-url="${escapeHtml(sourceUrl || '')}">
      <h1>${escapeHtml(post?.title || 'Rockstar Newswire')}</h1>
      ${bodyParts.join('\n')}
    </article>
  </body>
</html>`;
}

async function resolveRockstarNewswireSource(fetchImpl = fetch) {
  const listData = await fetchRockstarGraphql(
    ROCKSTAR_NEWSWIRE_LIST_QUERY,
    { locale: 'en-US', page: 1, limit: 10, tagId: ROCKSTAR_GTA_ONLINE_TAG_ID, metaUrl: '/newswire', cache: true },
    fetchImpl,
  );
  const postSummary = findRockstarNewswirePost(listData?.posts?.results);
  if (!postSummary) throw new Error('Could not find a GTA Online post in Rockstar Newswire');
  const postData = await fetchRockstarGraphql(
    ROCKSTAR_NEWSWIRE_POST_QUERY,
    { id_hash: postSummary.id, locale: 'en-US', cache: true },
    fetchImpl,
  );
  const post = postData?.post;
  if (!post) throw new Error(`Could not fetch Rockstar Newswire post ${postSummary.id}`);
  const sourceUrl = `https://www.rockstargames.com${postSummary.url}`;
  return { sourceUrl, html: rockstarPostToHtml(post, sourceUrl) };
}

async function resolveGtabaseSource() {
  try {
    const indexHtml = await readSource(GTABASE_SOURCE_INDEX_URL);
    const weeklySourceUrl = findWeeklySourceUrl(indexHtml);
    if (!weeklySourceUrl) {
      throw new Error(`Could not find a GTA Online weekly update link on ${GTABASE_SOURCE_INDEX_URL}`);
    }
    return { sourceUrl: weeklySourceUrl, html: await readSource(weeklySourceUrl) };
  } catch (error) {
    throw new Error(`GTABase source failed: ${error.message}`);
  }
}

async function resolveSourceCandidates(sourceUrl) {
  if (sourceUrl) return [{ sourceUrl, html: await readSource(sourceUrl) }];

  const candidates = [];
  try {
    candidates.push(await resolveRockstarNewswireSource());
  } catch (error) {
    console.warn(`Rockstar Newswire source discovery failed: ${error.message}`);
  }
  candidates.push(await resolveGtabaseSource());
  return candidates;
}

async function main() {
  const sourceArgIndex = process.argv.indexOf('--source-url');
  const sourceUrl =
    sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : process.env.GTA_WEEKLY_SOURCE_URL;
  const outputDir = process.env.GTA_WEEKLY_OUTPUT_DIR || process.cwd();
  const now = new Date();
  const sources = await resolveSourceCandidates(sourceUrl);
  try {
    const result = await generateFirstValidWeeklyFiles(sources, { outputDir, now });
    console.log(`Generated weekly content for ${result.weekId} from ${result.sourceUrl}`);
  } catch (error) {
    // No fresh source this run. If the already-published content still covers the
    // current GTA week, that is not a failure — keep it and exit cleanly so the
    // daily job stays green when there is simply nothing new to publish. A real
    // failure (nothing current on disk either) still surfaces as a non-zero exit.
    const existing = await readLatestWeekly(path.join(outputDir, 'weekly'));
    if (weeklyIsCurrent(existing, now)) {
      console.log(
        `No fresh source found; keeping current weekly ${existing.weekId} (still within this GTA week).`,
      );
      return;
    }
    throw error;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
