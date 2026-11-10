import test from 'node:test';
import assert from 'node:assert/strict';
import { findOfferPosts, uncoveredOffers, checkOfferSignals } from '../scripts/time-limited-offers.mjs';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const item = (title, pubDate, link = 'https://rockstarintel.com/x/') =>
  `<item><title><![CDATA[${title}]]></title><link>${link}</link><pubDate>${pubDate}</pubDate></item>`;
const feed = (...items) => `<?xml version="1.0"?><rss><channel>${items.join('')}</channel></rss>`;

test('matches GTA Online offer kinds inside the 7-day window', () => {
  const xml = feed(
    item('GTA Online Twitch Drops This Weekend Only', 'Fri, 31 Oct 2026 10:00:00 GMT', 'https://rockstarintel.com/drops/'),
    item('Prime Gaming rewards for GTA Online this month', 'Thu, 30 Oct 2026 09:00:00 GMT', 'https://rockstarintel.com/prime/'),
    item('GTA Online Login Bonus week returns', 'Thu, 30 Oct 2026 09:00:00 GMT', 'https://rockstarintel.com/login/'),
  );
  const posts = findOfferPosts(xml, NOW);
  assert.deepEqual(posts.map(p => p.kind), ['twitch', 'prime', 'login']);
  assert.equal(posts[0].publishedAt, '2026-10-31T10:00:00.000Z');
});

test('skips non-GTA-Online items, unmatched kinds, old posts and future posts', () => {
  const xml = feed(
    item('GTA 6 Pre-Order Numbers Are Unprecedented', 'Fri, 31 Oct 2026 10:00:00 GMT'),
    item('GTA Online Event Week: Halloween Ends November 4th', 'Fri, 31 Oct 2026 10:00:00 GMT'),
    item('GTA Online Twitch Drops return', 'Fri, 20 Oct 2026 10:00:00 GMT', 'https://rockstarintel.com/old/'),
    item('GTA Online weekend event announced', 'Mon, 10 Nov 2026 10:00:00 GMT', 'https://rockstarintel.com/future/'),
  );
  assert.equal(findOfferPosts(xml, NOW).length, 0);
});

test('covered, uncovered and acknowledged posts', () => {
  const posts = [
    { kind: 'twitch', title: 'Twitch Drops', url: 'https://a/', publishedAt: 'x' },
    { kind: 'prime', title: 'Prime rewards', url: 'https://b/', publishedAt: 'x' },
    { kind: 'login', title: 'Login bonus', url: 'https://c/', publishedAt: 'x' },
  ];
  const publication = { sections: [{ items: [{ name: 'Grotti Turismo', offer: 'watch twitch streams' }] }] };
  assert.deepEqual(uncoveredOffers(posts, publication, []).map(p => p.kind), ['prime', 'login']);
  assert.deepEqual(uncoveredOffers(posts, publication, ['https://b/']).map(p => p.kind), ['login']);
  assert.equal(uncoveredOffers(posts, null, []).length, 3);
});

test('checkOfferSignals records feed errors without throwing', async () => {
  const failing = async () => new Response('err', { status: 503 });
  const result = await checkOfferSignals({ fetchImpl: failing, now: NOW });
  assert.equal(result.error, 'feed_http_503');
  assert.deepEqual(result.unreviewed, []);
  const throwing = async () => { throw new Error('dns fail'); };
  const result2 = await checkOfferSignals({ fetchImpl: throwing, now: NOW });
  assert.match(result2.error, /dns fail/);
});

test('checkOfferSignals reports uncovered posts from a live-shaped feed', async () => {
  const xml = feed(item('How To Get A Free Supercar In GTA Online This Weekend with Twitch Drops', 'Sat, 31 Oct 2026 10:00:00 GMT', 'https://rockstarintel.com/drops/'));
  const fetchImpl = async () => new Response(xml, { status: 200 });
  const result = await checkOfferSignals({ fetchImpl, publication: { sections: [] }, now: NOW });
  assert.equal(result.unreviewed.length, 1);
  assert.equal(result.unreviewed[0].kind, 'twitch');
});
