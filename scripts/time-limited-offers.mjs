// Wykrywa aktywne oferty czasowe GTA Online (Twitch Drops, Prime Gaming,
// nagrody za logowanie, wydarzenia weekendowe) w głównym RSS RockstarINTEL
// i wskazuje wpisy nieobjęte opublikowanym wydaniem. Tylko sygnał — moduł
// nie publikuje i nie tworzy faktów.
import { safeFetch, readBounded } from './http.mjs';

const OFFER_FEED_URL = 'https://rockstarintel.com/feed/';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KINDS = [
  ['twitch', /twitch drops?/i],
  ['prime', /prime gaming/i],
  ['login', /log ?in (bonus|reward)|login reward/i],
  ['weekend', /weekend event/i],
];
const GTA_CONTEXT = /gta online|gta\+|grand theft auto online/i;
const KIND_KEYWORDS = { twitch: /twitch/i, prime: /prime gaming/i, login: /log ?in|login/i, weekend: /weekend/i };

const clean = value => String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function findOfferPosts(feedXml, now = Date.now()) {
  const posts = [];
  for (const [, item] of String(feedXml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const title = clean((item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
    if (!GTA_CONTEXT.test(title)) continue;
    const kind = KINDS.find(([, pattern]) => pattern.test(title))?.[0];
    if (!kind) continue;
    const publishedAt = Date.parse(clean((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1]));
    if (!Number.isFinite(publishedAt) || publishedAt > now || now - publishedAt > WEEK_MS) continue;
    const url = clean((item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
    if (url) posts.push({ kind, title, url, publishedAt: new Date(publishedAt).toISOString() });
    if (posts.length >= 10) break;
  }
  return posts;
}

export function uncoveredOffers(posts, publication, acknowledged = []) {
  const text = JSON.stringify(publication?.sections || []).toLowerCase();
  const ack = new Set(acknowledged);
  return (posts || []).filter(post => !ack.has(post.url) && !(KIND_KEYWORDS[post.kind] && KIND_KEYWORDS[post.kind].test(text)));
}

export async function checkOfferSignals({ publication, acknowledged = [], now = Date.now(), fetchImpl = safeFetch } = {}) {
  try {
    const response = await fetchImpl(OFFER_FEED_URL);
    if (response.status !== 200) return { checkedAt: new Date(now).toISOString(), error: 'feed_http_' + response.status, unreviewed: [] };
    const xml = await readBounded(response);
    const posts = findOfferPosts(xml, now);
    return { checkedAt: new Date(now).toISOString(), posts, unreviewed: uncoveredOffers(posts, publication, acknowledged) };
  } catch (error) {
    return { checkedAt: new Date(now).toISOString(), error: String(error?.message || error).slice(0, 180), unreviewed: [] };
  }
}
