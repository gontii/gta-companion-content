import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTggCandidate, TGG_CHANNEL } from '../scripts/source-service.mjs';

const video = {
  videoId: 'mzcpiXtW5MA', channelId: TGG_CHANNEL, publishedOn: '2026-10-07T22:00:19+00:00',
  title: 'GTA HALLOWEEN UPDATE WEEK 2! TRIPLE MONEY & DISCOUNTS (Cayo Perico, Limited-Time Vehicles & More)',
};
test('the verified seasonal weekly title is eligible without the literal GTA Online phrase', () => {
  assert.equal(selectTggCandidate([video], Date.parse('2026-10-09T19:00:00Z'))?.videoId, video.videoId);
});
test('seasonal selection still rejects wrong channels, GTA6, stale and undated videos', () => {
  for (const override of [{ channelId: 'fake' }, { title: 'GTA 6 HALLOWEEN UPDATE WEEK 2' },
    { publishedOn: '2026-09-07T22:00:19Z' }, { publishedOn: '2 days ago' },
    { title: 'GTA HALLOWEEN MONEY GUIDE' }]) {
    assert.equal(selectTggCandidate([{ ...video, ...override }], Date.parse('2026-10-09T19:00:00Z')), null);
  }
});
