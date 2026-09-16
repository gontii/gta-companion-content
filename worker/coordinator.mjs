import { AiBudget } from '../scripts/ai-budget.mjs';
import { SourceService } from '../scripts/source-service.mjs';
import { agreeSources, factKey, factWindow, hash, mergeFacts, upgradeLegacy, validateSnapshot, FACT_VALIDATION_VERSION } from '../scripts/facts.mjs';
import { collectEvents, nextCheck, projectContent, windowFromDays, localParts, atLocal, MINUTE, DAY, TIMING_POLICY_VERSION } from '../scripts/temporal.mjs';
import { thursdayWeekId } from '../scripts/weekly-core.mjs';
import { safeFetch, readBounded } from '../scripts/http.mjs';

function publicSnapshot(c) {
  // Evidence stays in private object storage. Public history contains facts and citations,
  // never the source article, transcript, access token or a full set of quoted passages.
  return JSON.parse(JSON.stringify(c, (key, value) => ['evidence', 'dateEvidence', 'editorial'].includes(key) ? undefined : value));
}
export class PublicationEngine {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.store = ctx.storage; this.running = null; }
  async status() {
    const state = await this.store.get('state') || {};
    const master = await this.store.get('master');
    const outbox = await this.store.list({ prefix: 'outbox:', limit: 100 });
    const extraction = [...(await this.store.list({ prefix: 'extracted:', limit: 12 })).values()].map(v => ({
      cachedAt: v.cachedAt, accepted: v.facts.length, rejected: v.rejected.slice(0, 5),
      sample: v.facts.slice(0, 2).map(f => ({ entity: f.entity, offer: f.offer, startsOn: f.startsOn, endsOn: f.endsOn, sourceUrl: f.sources[0].url })),
    }));
    return { mode: this.env.PUBLICATION_MODE, ...state, outboxCount: outbox.size, progress: await this.store.get('progress'),
      extraction, aiBudget: await new AiBudget(this.store).state(),
      candidate: master ? publicSnapshot(projectContent(master, Date.now())) : null,
      approvedFacts: [...(await this.store.list({ prefix: 'fact:', limit: 1000 })).values()].map(({ evidence, dateEvidence, ...fact }) => fact),
      tggProbe: await this.store.get('tgg-probe'),
      transcriptCheck: await this.store.get('transcript-check'),
      tggDiscovery: await this.store.get('tgg-discovery-check'),
      apiAccessCheck: await this.store.get('api-access-check'),
      heartbeatAt: new Date((await this.store.get('heartbeat')) || 0).toISOString(),
      needsSmokeToken: !await this.store.get('smoke-token-set-at') || Date.now() - await this.store.get('smoke-token-set-at') > DAY };
  }
  async outbox() { return { entries: [...(await this.store.list({ prefix: 'outbox:', limit: 10 })).values()] }; }
  async ack(ids) {
    for (const id of ids.slice(0, 10)) if (/^[a-f0-9]{64}$/.test(id)) await this.store.delete(`outbox:${id}`);
  }
  async setSmokeToken(token) {
    if (token.length > 12000) throw new Error('smoke_token_invalid');
    const response = await safeFetch('https://gtacompanion.net/api/weekly', { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('smoke_token_rejected');
    await readBounded(response, 150000);
    await this.store.put('api-access-check', { checkedAt: new Date().toISOString(), status: response.status, cacheControl: response.headers.get('cache-control') });
    await this.store.put('smoke-token', token);
    await this.store.put('smoke-token-set-at', Date.now());
    await this.requestCheck();
  }
  async requestCheck() {
    // A request cannot race an in-flight run's final state write.
    await this.store.put('check-requested', true);
    await this.store.setAlarm(Date.now() + 1000);
  }
  async requestTggProbe() {
    if (this.env.PUBLICATION_MODE !== 'observe') throw new Error('probe_requires_observe');
    await this.store.put('tgg-probe-requested', true);
    await this.store.put('tgg-probe-next-at', Date.now());
    await this.store.setAlarm(Date.now() + 1000);
  }
  async wake() {
    const alarm = await this.store.getAlarm();
    const state = await this.store.get('state');
    if (state?.timingPolicyVersion !== TIMING_POLICY_VERSION || !alarm || alarm < Date.now() - 2 * MINUTE) await this.store.setAlarm(Date.now() + 1000);
    await this.store.put('heartbeat', Date.now());
  }
  async alarm() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async queueHistory(snapshot, verifiedAt = null) {
    const id = await hash([snapshot.revision, verifiedAt ? 'verified' : 'published']);
    await this.store.put(`outbox:${id}`, { id, snapshot, verifiedAt });
  }
  async run() {
    const now = Date.now();
    const state = await this.store.get('state') || { events: [], incidents: [] };
    // Supervisor can recover even after all platform alarm retries are exhausted.
    await this.store.setAlarm(now + 15 * MINUTE);
    state.lastAttemptAt = new Date(now).toISOString();
    await this.store.put('state', state);
    let nextAt = now + 15 * MINUTE;
    try {
      if (this.env.PUBLICATION_MODE === 'observe' && await this.store.get('tgg-probe-requested') &&
          ((await this.store.get('tgg-probe-next-at')) || 0) <= now) {
        await this.store.delete('tgg-probe-requested');
        await this.store.delete('tgg-probe-next-at');
        try {
          const probe = await new SourceService(this.store, this.env, now).tgg();
          await this.store.put('tgg-probe', { checkedAt: new Date(now).toISOString(), source: probe.source,
            facts: probe.facts.map(f => ({ entity: f.entity, offer: f.offer, startsOn: f.startsOn, endsOn: f.endsOn, offsetMs: f.offsetMs })), rejected: probe.rejected });
        } catch (error) {
          let retryAt = null;
          if (['ai_local_budget_reserved', 'ai_free_budget_exhausted'].includes(error.message)) retryAt = Math.floor(now / DAY) * DAY + DAY + 2 * MINUTE;
          else if (['transcript_job_pending', 'transcript_retry_not_due'].includes(error.message)) {
            retryAt = Math.max(now + MINUTE, (await this.store.get('transcript-check'))?.retryAt || now + 15 * MINUTE);
          }
          if (!retryAt && Number.isFinite(error.retryAt)) retryAt = Math.max(now + MINUTE, error.retryAt);
          if (retryAt) {
            await this.store.put('tgg-probe-next-at', retryAt);
            await this.store.put('tgg-probe-requested', true);
          }
          await this.store.put('tgg-probe', { checkedAt: new Date(now).toISOString(), error: error.message.slice(0, 180),
            retryAt: retryAt ? new Date(retryAt).toISOString() : null });
        }
      }
      let master = await this.store.get('master');
      if (this.env.PUBLICATION_MODE === 'observe' && state.validationVersion !== FACT_VALIDATION_VERSION) {
        // Experimental candidates never carry weaker validation into the first publication.
        if (master) await this.store.put(`archived-observation:${state.validationVersion || 0}`, master);
        master = null;
        await this.store.delete('master');
        for (const key of (await this.store.list({ prefix: 'fact:', limit: 1000 })).keys()) await this.store.delete(key);
        await this.store.delete('facts');
        state.nextCheck = null;
        state.validationVersion = FACT_VALIDATION_VERSION;
      }
      if (!master || (this.env.PUBLICATION_MODE === 'observe' && !await this.store.get('publication'))) {
        const legacy = await this.env.CONTENT_KV.get('weekly:latest', 'json');
        if (legacy) {
          const seedHash = await hash(legacy);
          // Preserve editorial corrections published while the new writer is still under review.
          if (!master || state.seedHash !== seedHash) master = upgradeLegacy(legacy);
          state.seedHash = seedHash;
        }
      }
      let facts = [...(await this.store.list({ prefix: 'fact:', limit: 1000 })).values()];
      if (!facts.length) facts = await this.store.get('facts') || [];
      if (master && state.timingPolicyVersion !== TIMING_POLICY_VERSION) {
        // Preserve the pre-migration evidence and history. Rebuild only affected deadlines.
        const archive = await this.store.get(`archived-timing:${TIMING_POLICY_VERSION}`);
        const oldEvents = collectEvents(archive?.master || master, [], now);
        const repaired = upgradeLegacy(master);
        const newKeys = new Set(collectEvents(repaired, [], now).map(e => e.key));
        const obsolete = new Set(oldEvents.filter(e => !newKeys.has(e.key)).map(e => e.key));
        for (const f of facts) {
          const timing = factWindow(f);
          const midnight = windowFromDays(f.startsOn, f.endsOn, false);
          if (timing.expiresAt !== midnight.expiresAt && !f.timing) {
            obsolete.add(`${f.startsOn}:expiresAt:${Date.parse(midnight.expiresAt)}`);
          }
        }
        for (const week of master.seasonalEvent?.weeks || []) {
          const old = windowFromDays(week.startsOn, week.endsOn, false);
          const updated = windowFromDays(week.startsOn, week.endsOn);
          if (old.expiresAt !== updated.expiresAt) obsolete.add(`${master.seasonalEvent.id}/${week.startsOn}:expiresAt:${Date.parse(old.expiresAt)}`);
        }
        if (!archive) await this.store.put(`archived-timing:${TIMING_POLICY_VERSION}`, { master, events: state.events || [] });
        master = repaired;
        state.events = (state.events || []).filter(e => !obsolete.has(e.key));
        state.timingPolicyVersion = TIMING_POLICY_VERSION;
        await this.store.put('master', master);
        await this.store.put('state', state);
      }
      const requested = await this.store.get('check-requested');
      if (requested) await this.store.delete('check-requested');
      if (requested || !state.nextCheck || state.nextCheck.at <= now) {
        const service = new SourceService(this.store, this.env, now);
        const result = await service.websites();
        if (!result.hasCurrentArticle) {
          try { result.documents.push(await service.tgg()); }
          catch (error) { result.failures.push({ kind: 'tgg', reason: error.message.slice(0, 180) }); }
        }
        const approved = agreeSources(result.documents, !result.hasCurrentArticle);
        const all = new Map(facts.filter(f => Date.parse(factWindow(f).expiresAt) > now).map(f => [factKey(f) + ':' + f.startsOn, f]));
        for (const f of approved) {
          const key = factKey(f) + ':' + f.startsOn;
          if (all.get(key)?.confidence === 'official' && f.confidence !== 'official') continue;
          all.set(key, f);
        }
        facts = [...all.values()];
        // Separate SQLite-backed rows avoid the 128 KiB per-value limit during long events.
        for (const f of facts) await this.store.put(`fact:${await hash([factKey(f), f.startsOn])}`, f);
        const rows = await this.store.list({ prefix: 'fact:', limit: 1000 });
        for (const [key, f] of rows) if (Date.parse(factWindow(f).expiresAt) <= now) await this.store.delete(key);
        await this.store.delete('facts');
        state.lastSourceCheckAt = new Date(now).toISOString();
        state.sources = result.documents.map(d => ({ ...d.source, current: d.current, period: d.period, facts: d.facts.length, rejected: d.rejected.length }));
        state.sourceFailures = result.failures;
        await service.prune();
      }
      const merged = await mergeFacts(master, facts, now);
      if (merged) {
        master = merged;
        validateSnapshot(master);
        await this.store.put('master', master);
        // The master owns its subtree, including removed/replaced item ids. Old revisions
        // must not leave orphan alarms; future facts are added again below.
        const ownedRoots = [`${master.weekId}/`, `${master.weekId}:`, ...(master.seasonalEvent ? [`${master.seasonalEvent.id}/`] : [])];
        const retained = (state.events || []).filter(e => !ownedRoots.some(root => e.key.startsWith(root)));
        state.events = collectEvents(master, retained, now);
        for (const f of facts) {
          state.events = collectEvents({ weekId: f.startsOn, ...factWindow(f), label: f.entity, sourceUrl: f.sources[0].url }, state.events, now);
        }
        const projected = publicSnapshot(projectContent(master, now));
        delete projected.generatedAt; delete projected.revision;
        const revision = await hash(projected);
        const publication = await this.store.get('publication');
        if (revision !== publication?.revision && this.env.PUBLICATION_MODE === 'publish' && !await this.store.get('pending-publication')) {
          const snapshot = { ...projected, revision, generatedAt: new Date(now).toISOString() };
          // Write-ahead record: after a crash repeat exactly the same payload/revision.
          await this.store.put('pending-publication', snapshot);
        }
        state.candidateRevision = revision;
      }
      const pending = await this.store.get('pending-publication');
      if (pending && this.env.PUBLICATION_MODE === 'publish') {
        const old = await this.store.get('publication');
        if (old) await this.store.put('previous-publication', old);
        await this.env.CONTENT_KV.put('weekly:latest', JSON.stringify(pending));
        await this.store.put('publication', pending);
        await this.queueHistory(pending);
        await this.store.delete('pending-publication');
        state.publishedRevision = pending.revision;
        state.lastPublishedAt = new Date(now).toISOString();
        state.verifyAfter = now + 75_000;
        state.verifiedRevision = null;
      }
      const publication = await this.store.get('publication');
      if (publication && state.verifiedRevision !== publication.revision && state.verifyAfter <= now) {
        const token = await this.store.get('smoke-token');
        if (!token) throw new Error('smoke_token_missing');
        const denied = await safeFetch('https://gtacompanion.net/api/weekly');
        if (denied.status !== 401) throw new Error('weekly_api_not_gated');
        await denied.body?.cancel();
        const response = await safeFetch(`https://gtacompanion.net/api/weekly?revision=${publication.revision}`, { headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`weekly_api_http_${response.status}`);
        const live = JSON.parse(await readBounded(response, 150000));
        const expected = projectContent(publication, Date.now());
        if (await hash(live) !== await hash(expected)) throw new Error('weekly_api_content_mismatch');
        state.verifiedRevision = publication.revision;
        state.lastVerifiedAt = new Date().toISOString();
        await this.queueHistory(publication, state.lastVerifiedAt);
      }
      const currentWeek = thursdayWeekId(new Date(now));
      const expectedAt = atLocal(currentWeek, 11 * 60);
      const missing = !master || master.weekId < currentWeek || !projectContent(master, now).sections.some(s => ['bonuses', 'discounts'].includes(s.id) && s.items.length);
      state.awaitingOfficial = !state.sources?.some(s => s.kind === 'rockstar' && s.scope === 'weekly' && s.current && s.facts > 0);
      state.pending = missing || state.awaitingOfficial;
      state.expectedAt = new Date(expectedAt).toISOString();
      state.incidents = [];
      if (missing && now >= expectedAt + 15 * MINUTE) state.incidents.push({ key: `missing-${currentWeek}`, reason: 'Brak potwierdzonej aktualizacji po oczekiwanym terminie', since: state.expectedAt });
      for (const failure of state.sourceFailures || []) if (/budget_exhausted|local_budget_reserved|key_missing|binding_missing/.test(failure.reason)) {
        state.incidents.push({ key: failure.reason, reason: failure.reason, since: state.lastSourceCheckAt });
      }
      if (state.lastPublishedAt && state.verifiedRevision !== state.publishedRevision && now - Date.parse(state.lastPublishedAt) > 15 * MINUTE) state.incidents.push({ key: 'publication-unverified', reason: 'API nie potwierdziło pełnej publikacji', since: state.lastPublishedAt });
      state.lastCompletedAt = new Date().toISOString();
      state.lastError = null;
    } catch (error) {
      state.lastError = error.message.slice(0, 180);
      state.pending = true;
      state.incidents = [{ key: 'updater-error', reason: state.lastError, since: state.lastAttemptAt }];
    } finally {
      state.nextCheck = nextCheck(now, state.events || [], !!state.pending);
      nextAt = state.nextCheck.at;
      if (state.verifyAfter && state.verifiedRevision !== state.publishedRevision) nextAt = Math.min(nextAt, Math.max(now + MINUTE, state.verifyAfter));
      if (state.lastError) nextAt = Math.min(nextAt, now + 15 * MINUTE);
      // A request received during source IO must survive the final alarm write.
      if (await this.store.get('check-requested')) nextAt = Math.min(nextAt, Date.now() + 1000);
      if (this.env.PUBLICATION_MODE === 'observe' && await this.store.get('tgg-probe-requested')) {
        nextAt = Math.min(nextAt, Math.max(Date.now() + 1000, (await this.store.get('tgg-probe-next-at')) || 0));
      }
      state.nextRunAt = new Date(nextAt).toISOString();
      state.nextReason = state.lastError ? `Ponowienie: ${state.lastError}` : state.nextCheck.reason;
      state.heartbeatAt = new Date((await this.store.get('heartbeat')) || now).toISOString();
      await this.store.put('state', state);
      await this.store.setAlarm(nextAt);
      console.log(JSON.stringify({ event: 'content_update', mode: this.env.PUBLICATION_MODE, revision: state.publishedRevision,
        nextRunAt: state.nextRunAt, reason: state.nextReason, error: state.lastError || null }));
    }
  }
}
