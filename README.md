# gta-companion-content

Weekly content for the **Companion for GTA Online** app.

Production reads `weekly/latest.json` from Cloudflare KV key `weekly:latest`.
This repo is the source of truth: a daily automation updates JSON here, publishes
the same JSON to KV, and then smoke-tests the live gated API. No Pages redeploy
or `PREMIUM_WEEKLY_JSON` secret rotation should be needed for normal updates.

## One-time setup (owner)

1. Create a **public** GitHub repo named `gta-companion-content` on the `gontii` account.
2. Copy the contents of this folder (`weekly/`, this README) into it and push to `main`.
3. Done. The app already points at:
   `https://raw.githubusercontent.com/gontii/gta-companion-content/main/weekly/latest.json`
   (If you use a different account/repo name, change `CONTENT_BASE_URL` in
   `src/content/config.ts` in the app repo.)

## Automated daily update

GitHub Actions workflow: `.github/workflows/update-weekly.yml`. Runs once daily
(14:30 UTC) so mid-week event changes and hotfixes are caught, not just the
Thursday reset. Runs with nothing new to publish exit green (the current content
is kept); only a genuine failure with no current content on disk goes red.

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
3. Fails closed if the source period does not overlap the current GTA week or validation fails.
4. Commits changed weekly files.
5. Publishes `weekly/latest.json` to Cloudflare KV key `weekly:latest`.
6. Smoke-tests `https://companion-for-gta-online.pages.dev/api/weekly`.

## DLC overlay (`dlc-overlay.json`)

Hand-curated DLC guidance that must survive the daily regeneration lives in
`dlc-overlay.json` at the repo root (NOT in `weekly/` — the workflow only
commits `weekly/*.json`, and default `validate:weekly` runs would reject it).
The generator merges it into every generated week:

- `section` — prepended as the first section (id must be `dlc`; the app renders
  it at the top of This Week). All item ids must use the `dlc-` prefix; a
  scraped item whose slug collides gets renamed with a `-2` suffix automatically.
- `quickTake` — lines prepended to the generated quick take.
- `locations` — entries prepended to the generated locations.
- Items and locations may carry `"until": "YYYY-MM-DD"` — expired entries are
  dropped at generation time and the `until` field itself never reaches the
  published JSON, so limited-time advice retires itself.

Caveats:

- Overlay edits reach `latest.json`/KV only on the next **successful**
  generation. To force-apply the same day, mirror the edit into
  `weekly/latest.json` by hand (or dispatch the workflow with a valid
  `source_url`).
- Hand-edits to `weekly/latest.json` are clobbered by the next successful
  generation — the overlay is the durable channel for DLC content.
- Delete `dlc-overlay.json` to retire the DLC section entirely.

## Manual Thursday update

Primary source order:

1. Rockstar Games Newswire / official GTA Online post.
2. RockstarINTEL event-week post (discovered via the `/category/event-week/` RSS feed) as fallback when Rockstar has not published a parseable current weekly post yet. Its `<h3>` sections map cleanly to our categories, including discount percentages.

(The GTABase parser remains available for a manually supplied `GTA_WEEKLY_SOURCE_URL`, but is no longer in the automatic source chain.)

1. Copy the previous week's file, e.g. `weekly/2026-05-28.json` → `weekly/2026-06-04.json`.
2. Update the fields with this week's data (same research as the newsletter):
   - `weekId` — the Thursday date, `YYYY-MM-DD`
   - `range` — human-readable, e.g. `"June 4 - June 10, 2026"`
   - `headline` — one line, the 2–3 biggest things
   - `quickTake` — 3–4 one-liners
   - `sections` — ids: `bonuses`, `challenge`, `free-vehicles`, `discounts`, `gun-van`, `other`
     (optionally preceded by a `dlc` section — see "DLC overlay" above).
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
