#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateSnapshot } from './facts.mjs';

const baseUrl = process.env.SMOKE_BASE_URL || 'https://gtacompanion.net';
const expectedWeekId = process.env.EXPECTED_WEEK_ID;
const pollIntervalMs = 15000;
const pollDeadlineMs = 4 * 60 * 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const artifact = JSON.parse(await readFile(new URL('../weekly/latest.json', import.meta.url), 'utf8'));
  if (artifact.schemaVersion === 2) validateSnapshot(artifact, { published: true });
  if (!expectedWeekId) throw new Error('EXPECTED_WEEK_ID is required');

  const unauthorized = await fetch(`${baseUrl}/api/weekly`);
  if (unauthorized.status !== 401) {
    throw new Error(`/api/weekly without token returned ${unauthorized.status}, expected 401`);
  }

  const deadline = Date.now() + pollDeadlineMs;
  for (;;) {
    const response = await fetch(`${baseUrl}/api/content-status`);
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.app) throw new Error(`/api/content-status returned ${response.status}`);
    const { weekId, revision } = body.app;
    if (weekId === expectedWeekId && (artifact.schemaVersion !== 2 || revision === artifact.revision)) {
      console.log(`Smoke test passed for weekId ${expectedWeekId}${artifact.schemaVersion === 2 ? `, revision ${revision}` : ''}`);
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`/api/content-status still reports weekId ${weekId}, revision ${revision}; expected ${expectedWeekId}${artifact.schemaVersion === 2 ? `, revision ${artifact.revision}` : ''}`);
    }
    await sleep(pollIntervalMs);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
