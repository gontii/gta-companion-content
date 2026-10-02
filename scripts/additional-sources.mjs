import { safeFetch, readBounded } from './http.mjs';
import { cleanText, stripTags } from './weekly-core.mjs';

const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
async function read(url, fetchImpl = safeFetch) {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`source_http_${response.status}`);
  return readBounded(response);
}
export function findIgtaWeekly(html) {
  // Fixed-origin, exact article path. Never follow links to another host.
  const urls = [...String(html).matchAll(/href=["']([^"']+)["']/gi)].map(m => {
    try { return new URL(m[1], 'https://www.igrandtheftauto.com'); } catch { return null; }
  }).filter(u => u?.origin === 'https://www.igrandtheftauto.com' &&
    /^\/gtaonline\/news\/this-week-in-gta-online-[a-z]+-\d{1,2}-20\d{2}$/.test(u.pathname) && !u.search && !u.hash);
  return urls[0]?.href || null;
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
