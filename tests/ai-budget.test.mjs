import test from 'node:test';
import assert from 'node:assert/strict';
import { AiBudget, aiReservation } from '../scripts/ai-budget.mjs';
import { SourceService } from '../scripts/source-service.mjs';

class Storage {
  data = new Map();
  async get(k) { return structuredClone(this.data.get(k)); }
  async put(k, v) {
    for (const [key, value] of typeof k === 'object' ? Object.entries(k) : [[k, v]]) this.data.set(key, structuredClone(value));
  }
  async delete(k) { this.data.delete(k); }
}
const now = Date.parse('2026-09-16T08:50:00Z');
const doc = { text: 'September 17–23: Contact Missions pay 2X GTA$ & RP.', publishedOn: '2026-09-16',
  period: { startId: '2026-09-17', endId: '2026-09-23' }, source: { kind: 'rockstar', url: 'https://www.rockstargames.com/newswire/article/test' } };
const usage = { prompt_tokens: 400, completion_tokens: 100 };

test('confirmed tokens replace a reservation once; measurement and margin remain distinct', async () => {
  const store = new Storage(), budget = new AiBudget(store, now);
  const call = await budget.reserve([{ role: 'user', content: 'hello' }], 6000);
  assert.ok((await budget.state()).inFlight > 1000);
  const result = { response: '{"facts":[]}', usage };
  await budget.settle(call, result); await budget.settle(call, result);
  const state = await budget.state();
  assert.equal(state.inFlight, 0); assert.equal(state.requests, 1);
  assert.equal(state.measured, 32); assert.ok(state.safetyMargin > 0);
  assert.equal(state.uncertain, 0); assert.ok(state.measured + state.safetyMargin < 100);
});

test('unknown outcomes remain reserved across a restart, with a distinct local-budget error', async () => {
  const store = new Storage(); await store.put('ai:2026-09-16', 6000);
  const budget = new AiBudget(store, now), call = await budget.reserve([{ role: 'user', content: 'hello' }], 6000);
  await budget.settle(call, undefined, new Error('timeout'));
  const restarted = new AiBudget(store, now), state = await restarted.state();
  assert.equal(state.uncertain, 6000 + call.amount); assert.equal(state.failed, 1); assert.equal(state.inFlight, 0);
  await assert.rejects(() => restarted.reserve([{ role: 'user', content: 'hello' }], 6000), /ai_local_budget_reserved/);
  assert.equal((await new AiBudget(store, now + 86400000).state()).uncertain, 0);
});

test('a completed response without usage releases unused output allowance as an explicit estimate', async () => {
  const store = new Storage(), budget = new AiBudget(store, now);
  const call = await budget.reserve([{ role: 'user', content: 'hello' }], 6000);
  await budget.settle(call, { response: '{"facts":[]}' });
  const state = await budget.state();
  assert.equal(state.measured, 0); assert.equal(state.uncertain, 0); assert.equal(state.inFlight, 0);
  assert.ok(state.estimated > 0 && state.estimated < call.amount / 10);
});

test('invalid model JSON still settles measured usage and does not trigger paid retries on every source check', async () => {
  const store = new Storage(); let calls = 0;
  const env = { AI: { run: async () => { calls++; return { response: '{', usage }; } } };
  await assert.rejects(() => new SourceService(store, env, now).extract(doc), SyntaxError);
  assert.equal((await new AiBudget(store, now).state()).measured, 32);
  await assert.rejects(() => new SourceService(store, env, now + 1000).extract(doc), /ai_source_retry_not_due/);
  await assert.rejects(() => new SourceService(store, env, now + 15 * 60000).extract(doc), SyntaxError);
  await assert.rejects(() => new SourceService(store, env, now + 30 * 60000).extract(doc), /ai_source_retry_not_due/);
  assert.equal(calls, 2);
});

test('revalidating the same model response does not consume another inference', async () => {
  const store = new Storage(); let calls = 0;
  const env = { AI: { run: async () => { calls++; return { response: '{"facts":[]}', usage }; } } };
  const service = new SourceService(store, env, now);
  await service.extract(doc);
  for (const key of store.data.keys()) if (key.startsWith('extracted:')) await store.delete(key);
  await service.extract(doc);
  assert.equal(calls, 1); assert.equal((await new AiBudget(store, now).state()).requests, 1);
});

test('a short transcript reserves less than a long article; Unicode is bounded in bytes', () => {
  const short = aiReservation([{ role: 'user', content: 'a'.repeat(5000) }], 6000);
  const long = aiReservation([{ role: 'user', content: 'a'.repeat(16000) }], 6000);
  const unicode = aiReservation([{ role: 'user', content: '🎮'.repeat(5000) }], 6000);
  assert.ok(short.amount < long.amount); assert.ok(unicode.amount > long.amount);
});
