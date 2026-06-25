#!/usr/bin/env node
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

  const weekly = await fetch(`${baseUrl}/api/weekly`, {
    headers: { authorization: `Bearer ${redeemBody.token}` },
  });
  const weeklyBody = await expectJson(weekly, 'weekly');
  if (!weekly.ok) throw new Error(`/api/weekly returned ${weekly.status}`);
  if (weeklyBody.weekId !== expectedWeekId) {
    throw new Error(`/api/weekly weekId ${weeklyBody.weekId}, expected ${expectedWeekId}`);
  }

  console.log(`Smoke test passed for weekId ${expectedWeekId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
