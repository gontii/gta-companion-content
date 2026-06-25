# gta-companion-content

Weekly content for the **Companion for GTA Online** app.

Production reads `weekly/latest.json` from Cloudflare KV key `weekly:latest`.
This repo is the source of truth: Thursday automation updates JSON here, publishes
the same JSON to KV, and then smoke-tests the live gated API. No Pages redeploy
or `PREMIUM_WEEKLY_JSON` secret rotation should be needed for normal updates.

## One-time setup (owner)

1. Create a **public** GitHub repo named `gta-companion-content` on the `gontii` account.
2. Copy the contents of this folder (`weekly/`, this README) into it and push to `main`.
3. Done. The app already points at:
   `https://raw.githubusercontent.com/gontii/gta-companion-content/main/weekly/latest.json`
   (If you use a different account/repo name, change `CONTENT_BASE_URL` in
   `src/content/config.ts` in the app repo.)

## Automated Thursday update

GitHub Actions workflow: `.github/workflows/update-weekly.yml`.

Required repository variable:

- `GTA_WEEKLY_SOURCE_URL` — public source URL for the current Rockstar weekly update.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_KV_NAMESPACE_ID`
- `BETA_SMOKE_CODE`

Optional repository secret:

- `SMOKE_TEST_EMAIL`

The workflow:

1. Runs fixture tests for the parser.
2. Generates `weekly/<weekId>.json` and `weekly/latest.json`.
3. Fails closed if the source is not the current Thursday week or validation fails.
4. Commits changed weekly files.
5. Publishes `weekly/latest.json` to Cloudflare KV key `weekly:latest`.
6. Smoke-tests `https://companion-for-gta-online.pages.dev/api/weekly`.

## Manual Thursday update

1. Copy the previous week's file, e.g. `weekly/2026-05-28.json` → `weekly/2026-06-04.json`.
2. Update the fields with this week's data (same research as the newsletter):
   - `weekId` — the Thursday date, `YYYY-MM-DD`
   - `range` — human-readable, e.g. `"June 4 - June 10, 2026"`
   - `headline` — one line, the 2–3 biggest things
   - `quickTake` — 3–4 one-liners
   - `sections` — ids: `bonuses`, `challenge`, `free-vehicles`, `discounts`, `gun-van`, `other`.
     Every item needs a unique `id` (kebab-case) and a `label`.
     Optional `"tag": "gold"` (top pick) or `"tag": "limited"` (expiring).
   - `beginnerPath` — 3–5 beginner tips for this week
   - `locations` — optional; `activity` (group header), `name`, `area`, optional `note`
3. Overwrite `weekly/latest.json` with the same content (the app only reads `latest.json`).
4. Validate before pushing: `npm run validate:weekly -- weekly/latest.json`
5. Commit and push to `main`.
6. Publish to KV:
   `npx wrangler kv key put weekly:latest --path weekly/latest.json --namespace-id "$CLOUDFLARE_KV_NAMESPACE_ID"`

## Rules

- English only, gamer-to-gamer tone, no fluff.
- No Rockstar/Take-Two assets of any kind — text only.
- Checkbox `id`s must be unique within a week (progress is stored per id).
