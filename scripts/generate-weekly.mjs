#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySeasonalContent, isSeasonalEvent } from './seasonal-content.mjs';
import { applyMemberBenefits, validatePublication, requireMemberPeriod, PublicationQualityError } from './publication-quality.mjs';

import { buildWeeklyContent, validateContent, weeklyIsCurrent, resolveSourceCandidates } from './weekly-core.mjs';
export * from './weekly-core.mjs';
const WEEKLY_SECTION_IDS = ['bonuses', 'challenge', 'free-vehicles', 'discounts', 'gun-van', 'other'];

function withoutGeneratedAt(content) {
  const clone = structuredClone(content);
  delete clone.generatedAt;
  return clone;
}

function weeklyItemCount(content) {
  return Array.isArray(content?.sections)
    ? content.sections.filter(section => WEEKLY_SECTION_IDS.includes(section.id)).reduce(
        (total, section) => total + (Array.isArray(section?.items) ? section.items.length : 0),
        0,
      )
    : 0;
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

// The overlay lives in the repo root (not weekly/) so default validate-weekly
// runs and the workflow's `git add weekly/*.json` never touch it.
async function readDlcOverlay(outputDir) {
  try {
    return JSON.parse(await readFile(path.join(outputDir, 'dlc-overlay.json'), 'utf8'));
  } catch {
    return null;
  }
}

export async function generateWeeklyFiles({ html, outputDir = '.', now = new Date(), sourceUrl = null } = {}) {
  const overlay = await readDlcOverlay(outputDir);
  let content = buildWeeklyContent(html, { now, sourceUrl, overlay });
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
  if (
    currentLatest?.weekId === content.weekId &&
    weeklyItemCount(currentLatest) > weeklyItemCount(content) &&
    content.sections.filter(s => WEEKLY_SECTION_IDS.includes(s.id)).every(s =>
      (currentLatest.sections.find(old => old.id === s.id)?.items.length || 0) >= s.items.length)
  ) {
    console.log(
      `Keeping richer existing weekly ${content.weekId}: ` +
        `${weeklyItemCount(currentLatest)} items versus ${weeklyItemCount(content)} generated items.`,
    );
    content = currentLatest;
  }

  const preservedExisting = content === currentLatest;
  const result = await writeCuratedWeekly(content, outputDir, now);
  return { ...result, preservedExisting };
}

export async function writeCuratedWeekly(input, outputDir = '.', now = new Date()) {
  const weeklyDir = path.join(outputDir, 'weekly');
  const content = applyMemberBenefits(applySeasonalContent(input, now), now);
  validateContent(content);
  validatePublication(content, now);
  const existingContent = await readExistingWeeklyContent(weeklyDir, content.weekId);
  content.generatedAt = existingContent?.generatedAt &&
    JSON.stringify(withoutGeneratedAt(existingContent)) === JSON.stringify(withoutGeneratedAt(content))
    ? existingContent.generatedAt : now.toISOString();
  const serialized = `${JSON.stringify(content, null, 2)}\n`;
  await mkdir(weeklyDir, { recursive: true });
  await writeFile(path.join(weeklyDir, `${content.weekId}.json`), serialized);
  await writeFile(path.join(weeklyDir, 'latest.json'), serialized);
  return { weekId: content.weekId, content };
}

export async function generateFirstValidWeeklyFiles(sources, options = {}) {
  const failures = [];
  let qualityFailure = false;
  for (const source of sources) {
    try {
      const result = await generateWeeklyFiles({ ...options, ...source });
      return { ...result, sourceUrl: source.sourceUrl };
    } catch (error) {
      qualityFailure ||= error instanceof PublicationQualityError;
      failures.push(`${source.sourceUrl || 'unknown source'}: ${error.message}`);
    }
  }
  const ErrorType = qualityFailure ? PublicationQualityError : Error;
  throw new ErrorType(`No valid weekly source found. ${failures.join(' | ')}`);
}

async function main() {
  const sourceArgIndex = process.argv.indexOf('--source-url');
  const sourceUrl =
    sourceArgIndex >= 0 ? process.argv[sourceArgIndex + 1] : process.env.GTA_WEEKLY_SOURCE_URL;
  const outputDir = process.env.GTA_WEEKLY_OUTPUT_DIR || process.cwd();
  const now = new Date();
  const sources = sourceUrl?.startsWith('file://') ? [{ sourceUrl, html: await readFile(fileURLToPath(sourceUrl), 'utf8') }] : await resolveSourceCandidates(sourceUrl);
  try {
    const result = await generateFirstValidWeeklyFiles(sources, { outputDir, now });
    console.log(`Generated weekly content for ${result.weekId} from ${result.sourceUrl}`);
  } catch (error) {
    if (error instanceof PublicationQualityError) throw error;
    // No fresh source this run. If the already-published content still covers the
    // current GTA week, that is not a failure — keep it and exit cleanly so the
    // daily job stays green when there is simply nothing new to publish. A real
    // failure (nothing current on disk either) still surfaces as a non-zero exit.
    const existing = await readLatestWeekly(path.join(outputDir, 'weekly'));
    if (weeklyIsCurrent(existing, now)) {
      await writeCuratedWeekly(existing, outputDir, now);
      console.log(
        `No fresh source found; keeping current weekly ${existing.weekId} (still within this GTA week).`,
      );
      return;
    }
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
