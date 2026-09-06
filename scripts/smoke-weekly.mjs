#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { assertPublishedContent, requireMemberPeriod } from './publication-quality.mjs';
import { applySeasonalContent, isRetiredDlcAnnouncement, isSeasonalEvent } from './seasonal-content.mjs';

const baseUrl = process.env.SMOKE_BASE_URL || 'https://companion-for-gta-online.pages.dev';
const code = process.env.BETA_SMOKE_CODE;
const email = process.env.SMOKE_TEST_EMAIL || 'smoke@gta-companion.local';
const expectedWeekId = process.env.EXPECTED_WEEK_ID;

async function expectJson(response, label) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${label} did not return JSON`);
  }
  return body;
}

async function main() {
  requireMemberPeriod();
  const artifact = JSON.parse(await readFile(new URL('../weekly/latest.json', import.meta.url), 'utf8'));
  if (!code) throw new Error('BETA_SMOKE_CODE is required');
  if (!expectedWeekId) throw new Error('EXPECTED_WEEK_ID is required');

  const unauthorized = await fetch(`${baseUrl}/api/weekly`);
  if (unauthorized.status !== 401) {
    throw new Error(`/api/weekly without token returned ${unauthorized.status}, expected 401`);
  }

  const redeem = await fetch(`${baseUrl}/api/access/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const redeemBody = await expectJson(redeem, 'redeem');
  if (!redeem.ok || !redeemBody.token) {
    throw new Error(`redeem returned ${redeem.status}, expected token`);
  }

  const weekly = await fetch(`${baseUrl}/api/weekly?publication=${encodeURIComponent(artifact.generatedAt)}`, {
    headers: { authorization: `Bearer ${redeemBody.token}` },
  });
  const weeklyBody = await expectJson(weekly, 'weekly');
  if (!weekly.ok) throw new Error(`/api/weekly returned ${weekly.status}`);
  if (weeklyBody.weekId !== expectedWeekId) {
    throw new Error(`/api/weekly weekId ${weeklyBody.weekId}, expected ${expectedWeekId}`);
  }

  if (weeklyBody.quickTake?.some(isRetiredDlcAnnouncement)) {
    throw new Error('Retired DLC announcement is still published');
  }
  const expected = applySeasonalContent(weeklyBody);
  if (expected.seasonalEvent) {
    if (!isSeasonalEvent(weeklyBody.seasonalEvent) ||
        JSON.stringify(weeklyBody.seasonalEvent) !== JSON.stringify(expected.seasonalEvent)) {
      throw new Error('Seasonal event is missing or differs from curated content');
    }
    const challenge = value => value.sections.find(s => s.id === 'challenge')?.items;
    if (JSON.stringify(challenge(weeklyBody)) !== JSON.stringify(challenge(expected))) {
      throw new Error('Weekly challenge does not include the curated seasonal reward');
    }
  } else if (weeklyBody.seasonalEvent?.id === 'business-rivalries-2026-09') {
    throw new Error('Expired seasonal event is still published');
  }
  assertPublishedContent(weeklyBody, artifact);
  console.log(`Smoke test passed for weekId ${expectedWeekId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
