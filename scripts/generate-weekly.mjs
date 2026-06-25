#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_SECTION_IDS = ['bonuses', 'challenge', 'free-vehicles', 'discounts', 'gun-van', 'other'];

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

export async function generateWeeklyFiles({ html, outputDir = '.', now = new Date(), sourceUrl = null } = {}) {
  const content = buildWeeklyContent(html, { now, sourceUrl });
  const weeklyDir = path.join(outputDir, 'weekly');
  await mkdir(weeklyDir, { recursive: true });

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

async function main() {
  const sourceArgIndex = process.argv.indexOf('--source-url');
  const sourceUrl =
    sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : process.env.GTA_WEEKLY_SOURCE_URL;
  const outputDir = process.env.GTA_WEEKLY_OUTPUT_DIR || process.cwd();
  const html = await readSource(sourceUrl);
  const result = await generateWeeklyFiles({ html, outputDir, sourceUrl });
  console.log(`Generated weekly content for ${result.weekId}`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
