# gta-companion-content

Weekly content for the **Companion for GTA Online** app. The app fetches
`weekly/latest.json` straight from this repo's raw URL — publishing here updates
every installed app with **no App Store release**.

## One-time setup (owner)

1. Create a **public** GitHub repo named `gta-companion-content` on the `gontii` account.
2. Copy the contents of this folder (`weekly/`, this README) into it and push to `main`.
3. Done. The app already points at:
   `https://raw.githubusercontent.com/gontii/gta-companion-content/main/weekly/latest.json`
   (If you use a different account/repo name, change `CONTENT_BASE_URL` in
   `src/content/config.ts` in the app repo.)

## Every Thursday (while writing the newsletter)

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
4. Validate before pushing — in the app repo run: `npm run validate-content -- path/to/latest.json`
5. Commit and push to `main`. The app picks it up on next launch / pull-to-refresh.

## Rules

- English only, gamer-to-gamer tone, no fluff.
- No Rockstar/Take-Two assets of any kind — text only.
- Checkbox `id`s must be unique within a week (progress is stored per id).
