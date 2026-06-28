#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECTION_IDS = ['bonuses', 'challenge', 'free-vehicles', 'discounts', 'gun-van', 'other'];
const DEFAULT_SOURCE_INDEX_URL = 'https://www.gtabase.com/grand-theft-auto-v/news/';

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

function formatRange(weekId) {
  const start = new Date(`${weekId}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const startMonth = monthName(start);
  const endMonth = monthName(end);
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const year = end.getUTCFullYear();
  return startMonth === endMonth
    ? `${startMonth} ${startDay} - ${endDay}, ${year}`
    : `${startMonth} ${startDay} - ${endMonth} ${endDay}, ${year}`;
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

  const fineArtItems = extractListItemsFrom(blockBetween(html, /<h2[^>]*>\s*Fine Art Collector Program\s*<\/h2>/i, /<h2[^>]*>\s*Weekly Challenge\s*<\/h2>/i));
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

export function findWeeklySourceUrl(indexHtml, { baseUrl = DEFAULT_SOURCE_INDEX_URL } = {}) {
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
  return thursdayWeekId(new Date(timestamp));
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

  for (const sectionId of REQUIRED_SECTION_IDS) {
    const bucket = buckets.get(sectionId);
    if (bucket.items.length === 0) {
      throw new Error(`Weekly source did not provide required section: ${sectionId}`);
    }
  }

  return REQUIRED_SECTION_IDS.map((id) => buckets.get(id));
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
  return sections.slice(0, 3).map((section) => ({
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
  if (!Array.isArray(content.sections) || content.sections.length !== 6) {
    throw new Error('sections must contain exactly 6 sections');
  }
  for (const section of content.sections) {
    requireString(section.id, 'section.id');
    requireString(section.title, 'section.title');
    if (!Array.isArray(section.items) || section.items.length === 0) throw new Error(`section ${section.id} has no items`);
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

export function buildWeeklyContent(html, options = {}) {
  const now = options.now || new Date();
  const expectedWeekId = options.weekId || thursdayWeekId(now);
  const publishedWeekId = extractPublishedWeekId(html);
  if (!publishedWeekId || publishedWeekId !== expectedWeekId) {
    throw new Error(`Source is not the current weekly update. Expected ${expectedWeekId}, got ${publishedWeekId || 'unknown'}`);
  }

  const sections = normalizeSections(extractSectionItems(html));
  const content = {
    weekId: expectedWeekId,
    range: formatRange(expectedWeekId),
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

export async function generateWeeklyFiles({ html, outputDir = '.', now = new Date(), sourceUrl = null } = {}) {
  const content = buildWeeklyContent(html, { now, sourceUrl });
  const weeklyDir = path.join(outputDir, 'weekly');
  await mkdir(weeklyDir, { recursive: true });

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

async function readSource(sourceUrl) {
  if (!sourceUrl) throw new Error('Set GTA_WEEKLY_SOURCE_URL or pass --source-url');
  if (sourceUrl.startsWith('file://')) return readFile(fileURLToPath(sourceUrl), 'utf8');
  const response = await fetch(sourceUrl, { headers: { 'user-agent': 'gta-companion-content-bot/1.0' } });
  if (!response.ok) throw new Error(`Could not fetch source ${sourceUrl}: HTTP ${response.status}`);
  return response.text();
}

async function resolveSource(sourceUrl) {
  if (sourceUrl) return { sourceUrl, html: await readSource(sourceUrl) };

  const indexHtml = await readSource(DEFAULT_SOURCE_INDEX_URL);
  const weeklySourceUrl = findWeeklySourceUrl(indexHtml);
  if (!weeklySourceUrl) {
    throw new Error(`Could not find a GTA Online weekly update link on ${DEFAULT_SOURCE_INDEX_URL}`);
  }

  return { sourceUrl: weeklySourceUrl, html: await readSource(weeklySourceUrl) };
}

async function main() {
  const sourceArgIndex = process.argv.indexOf('--source-url');
  const sourceUrl =
    sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : process.env.GTA_WEEKLY_SOURCE_URL;
  const outputDir = process.env.GTA_WEEKLY_OUTPUT_DIR || process.cwd();
  const resolved = await resolveSource(sourceUrl);
  const result = await generateWeeklyFiles({ html: resolved.html, outputDir, sourceUrl: resolved.sourceUrl });
  console.log(`Generated weekly content for ${result.weekId}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
