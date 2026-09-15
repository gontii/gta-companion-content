import { DurableObject } from 'cloudflare:workers';
import { PublicationEngine } from './coordinator.mjs';
import { readBounded } from '../scripts/http.mjs';
const coordinator = env => env.CONTENT_COORDINATOR.getByName('weekly-publication');
const json = body => Response.json(body, { headers: { 'cache-control': 'no-store' } });
async function authorized(request, secret) {
  if (!secret) return false;
  const given = request.headers.get('authorization') || '';
  const encode = new TextEncoder();
  const [actual, expected] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(given)),
    crypto.subtle.digest('SHA-256', encode.encode(`Bearer ${secret}`)),
  ]);
  return crypto.subtle.timingSafeEqual(actual, expected);
}
export default {
  async scheduled(_event, env) { await coordinator(env).wake(); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!await authorized(request, env.AUTOMATION_TOKEN)) return new Response('Not found', { status: 404 });
    const object = coordinator(env);
    if (request.method === 'GET' && url.pathname === '/status') return json(await object.status());
    if (request.method === 'GET' && url.pathname === '/outbox') return json(await object.outbox());
    if (request.method === 'POST') {
      const raw = await readBounded(request, 16000);
      const body = raw ? JSON.parse(raw) : {};
      if (url.pathname === '/check') { await object.requestCheck(); return json({ accepted: true }); }
      if (url.pathname === '/probe-tgg' && env.PUBLICATION_MODE === 'observe') { await object.requestTggProbe(); return json({ accepted: true }); }
      if (url.pathname === '/ack' && Array.isArray(body.ids)) { await object.ack(body.ids); return json({ accepted: true }); }
      if (url.pathname === '/smoke-token' && typeof body.token === 'string') { await object.setSmokeToken(body.token); return json({ accepted: true }); }
    }
    return new Response('Not found', { status: 404 });
  },
};

export class ContentCoordinator extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.engine = new PublicationEngine(ctx, env); }
  async alarm() { return this.engine.alarm(); }
  async wake() { return this.engine.wake(); }
  async status() { return this.engine.status(); }
  async outbox() { return this.engine.outbox(); }
  async ack(ids) { return this.engine.ack(ids); }
  async requestCheck() { return this.engine.requestCheck(); }
  async setSmokeToken(token) { return this.engine.setSmokeToken(token); }
  async requestTggProbe() { return this.engine.requestTggProbe(); }
}
