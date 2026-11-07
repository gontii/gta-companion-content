import { safeFetch, readBounded } from './http.mjs';
import { cleanText, stripTags } from './weekly-core.mjs';

const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function read(url, fetchImpl = safeFetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`source_http_${response.status}`);
  return readBounded(response);
}
const IGTA_MONTHS = Object.fromEntries(['january','february','march','april','may','june','july','august','september','october','november','december'].map((name, index) => [name, index]));
// The weekly path keeps the month and Thursday date. Ordinals and a trailing
// slash have both shown up; a lookalike host or a query string has not.
function igtaWeeklyPath(pathname) {
  const match = pathname.match(/^\/gtaonline\/news\/this-week-in-gta-online-([a-z]+)-(\d{1,2})(?:st|nd|rd|th)?-(20\d{2})\/?$/);
  if (!match || !Object.hasOwn(IGTA_MONTHS, match[1])) return null;
  const day = Number(match[2]);
  const stamp = Date.UTC(Number(match[3]), IGTA_MONTHS[match[1]], day);
  const parsed = new Date(stamp);
  if (parsed.getUTCFullYear() !== Number(match[3]) || parsed.getUTCMonth() !== IGTA_MONTHS[match[1]] || parsed.getUTCDate() !== day) return null;
  return stamp;
}
export function findIgtaWeekly(html) {
  // Fixed-origin article path. Never follow links to another host.
  const urls = [...String(html).matchAll(/href=["']([^"']+)["']/gi)].map(m => {
    try { return new URL(m[1], 'https://www.igrandtheftauto.com'); } catch { return null; }
  }).filter(u => u?.origin === 'https://www.igrandtheftauto.com' && igtaWeeklyPath(u.pathname) !== null && !u.search && !u.hash);
  urls.sort((a, b) => igtaWeeklyPath(b.pathname) - igtaWeeklyPath(a.pathname));
  return urls[0] ? urls[0].href.replace(/\/$/, '') : null;
}
export async function resolveIgtaSource(fetchImpl = safeFetch) {
  const sourceUrl = findIgtaWeekly(await read('https://www.igrandtheftauto.com/news', fetchImpl));
  if (!sourceUrl) throw new Error('igta_weekly_missing');
  return { sourceUrl, html: await read(sourceUrl, fetchImpl) };
}
export async function resolveGtaBossSource(fetchImpl = safeFetch) {
  const sourceUrl = 'https://www.gtaboss.gg/gta-5-online/gta-online-weekly-updates';
  return { sourceUrl, html: await read(sourceUrl, fetchImpl) };
}
export function findRedditWeekly(xml) {
  for (const [, entry] of String(xml).matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const title = stripTags(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    if (!/^Weekly Bonuses and Discounts\s*[-–]/i.test(title)) continue;
    const sourceUrl = cleanText(entry.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || '');
    let url; try { url = new URL(sourceUrl); } catch { continue; }
    if (url.origin !== 'https://www.reddit.com' || !/^\/r\/gtaonline\/comments\/[a-z0-9]+\//i.test(url.pathname)) continue;
    const published = entry.match(/<published[^>]*>([^<]+)<\/published>/i)?.[1];
    if (!Number.isFinite(Date.parse(published))) continue;
    // Only the post body, never replies/votes or unrelated feed entries.
    const body = stripTags(cleanText(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] || ''));
    if (!body.trim()) continue;
    return { sourceUrl: url.href, html: `<meta property="article:published_time" content="${escape(published)}"><article><h1>${escape(title)}</h1><p>${escape(body)}</p></article>` };
  }
  return null;
}
export async function resolveRedditSource(fetchImpl = safeFetch) {
  const result = findRedditWeekly(await read('https://www.reddit.com/r/gtaonline/hot/.rss?limit=100', fetchImpl));
  if (!result) throw new Error('reddit_weekly_missing');
  return result;
}
