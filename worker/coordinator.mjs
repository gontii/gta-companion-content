import { createBundle } from '../scripts/publication-bundle.mjs';
import { rebuildWeeklyLocations } from '../scripts/weekly-locations.mjs';
import { collectSectionEvidence, inspectSectionCoverage } from '../scripts/section-coverage.mjs';
import { supplementReviewedFacts, normalizeReviewedSources } from '../scripts/reviewed-weekly.mjs';
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
    const extraction = [...(await this.store.list({ prefix: 'last-extraction:', limit: 12 })).values()];
    return { mode: this.env.PUBLICATION_MODE, publicationPaused: !!await this.store.get('publication-paused'), ...state, outboxCount: outbox.size, progress: await this.store.get('progress'),
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
  async rollback(revision) {
    if (this.running) throw new Error('rollback_run_in_flight');
    const publication = await this.store.get('publication');
    if (!revision || publication?.revision !== revision) throw new Error('rollback_revision_changed');
    const previous = await this.store.get('previous-publication');
    const page = await this.store.get('previous-public-page');
    if (!previous || !page) throw new Error('rollback_baseline_missing');
    await this.store.put('publication-paused', true);
    await this.store.put('rollback-current-master', await this.store.get('master'));
    await this.store.put('rollback-current-state', await this.store.get('state'));
    await this.store.put('rollback-current-publication', publication);
    const edition = page.current || page.editions?.[0] || page;
    await this.env.CONTENT_KV.put(`weekly:public:${edition.issue}`, JSON.stringify(edition));
    await this.env.CONTENT_KV.put('weekly:latest', JSON.stringify(previous));
    await this.env.CONTENT_KV.put('weekly:public', JSON.stringify(page));
    await this.env.CONTENT_KV.put('weekly:receipt', JSON.stringify({ weekId: previous.weekId, verifiedRevision: null, verifiedAt: null }));
    await this.store.put('master', await this.store.get('previous-master'));
    for (const key of (await this.store.list({ prefix: 'fact:', limit: 1000 })).keys()) await this.store.delete(key);
    for (const key of await this.store.get('previous-fact-keys') || []) await this.store.put(key.replace('previous-', ''), await this.store.get(key));
    await this.store.put('publication', previous);
    await this.store.put('state', { ...await this.store.get('previous-coordinator-state'), verifiedRevision: null });
    await this.store.delete('pending-bundle');
    await this.store.delete('pending-publication');
    return { paused: true, revision: previous.revision };
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
    if (state?.timingPolicyVersion !== TIMING_POLICY_VERSION || state?.validationVersion !== FACT_VALIDATION_VERSION || !alarm || alarm < Date.now() - 2 * MINUTE) await this.store.setAlarm(Date.now() + 1000);
    await this.store.put('heartbeat', Date.now());
  }
  async alarm() {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }
  async queueHistory(snapshot, verifiedAt = null) {
    const id = await hash([snapshot.revision, verifiedAt ? 'verified' : 'published']);
    const page = await this.store.get(`bundle:${snapshot.revision}:2`);
    await this.store.put(`outbox:${id}`, { id, snapshot, ...(page ? { publicPage: page } : {}), verifiedAt });
  }
  async run() {
    const now = Date.now();
    const state = await this.store.get('state') || { events: [], incidents: [] };
    const rollbackState = structuredClone(state);
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
      if (await this.store.get('publication-paused')) return;
      let master = normalizeReviewedSources(await this.store.get('master'));
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
      const rollbackFacts = [...facts];
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
      if (requested || state.validationVersion !== FACT_VALIDATION_VERSION || !state.nextCheck || state.nextCheck.at <= now) {
        const service = new SourceService(this.store, this.env, now);
        const result = await service.websites();
        if (!result.hasCurrentArticle) {
          try { result.documents.push(await service.tgg()); }
          catch (error) { result.failures.push({ kind: 'tgg', reason: error.message.slice(0, 180) }); }
        }
        const approved = agreeSources(result.documents, !result.hasCurrentArticle);
        const all = new Map((state.validationVersion === FACT_VALIDATION_VERSION ? facts : []).filter(f => Date.parse(factWindow(f).expiresAt) > now).map(f => [factKey(f) + ':' + f.startsOn, f]));
        for (const f of approved) {
          const key = factKey(f) + ':' + f.startsOn;
          if (all.get(key)?.confidence === 'official' && f.confidence !== 'official') continue;
          all.set(key, f);
        }
        facts = supplementReviewedFacts(master, [...all.values()], now);
        state.validationVersion = FACT_VALIDATION_VERSION;
        // Separate SQLite-backed rows avoid the 128 KiB per-value limit during long events.
        for (const f of facts) await this.store.put(`fact:${await hash([factKey(f), f.startsOn])}`, f);
        const rows = await this.store.list({ prefix: 'fact:', limit: 1000 });
        for (const [key, f] of rows) if (Date.parse(factWindow(f).expiresAt) <= now) await this.store.delete(key);
        await this.store.delete('facts');
        state.lastSourceCheckAt = new Date(now).toISOString();
        state.sources = result.documents.map(d => ({ ...d.source, current: d.current, period: d.period, facts: d.facts.length, rejected: d.rejected.length }));
        state.sourceFailures = result.failures;
        await this.store.put('section-evidence', collectSectionEvidence(result.documents, thursdayWeekId(new Date(now)), localParts(now).date));
        await service.prune();
      }
      const rollbackMaster = master;
      const merged = await mergeFacts(master, supplementReviewedFacts(master, facts, now), now);
      if (merged) {
        master = rebuildWeeklyLocations(merged, now);
        validateSnapshot(master);
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
        const revision = await hash([projected, { publicProjection: 2 }]);
        const publication = await this.store.get('publication');
        if ((revision !== publication?.revision || !await this.store.get('bundle-manifest')) && this.env.PUBLICATION_MODE === 'publish' && !await this.store.get('pending-bundle')) {
          const snapshot = { ...projected, revision, generatedAt: new Date(now).toISOString() };
          const page = await this.env.CONTENT_KV.get('weekly:public', 'json');
          const bundle = await createBundle(snapshot, page, now);
          // Each document is a separate SQLite row, below the per-value limit.
          for (let i = 0; i < bundle.values.length; i++) await this.store.put(`bundle:${revision}:${i}`, bundle.values[i]);
          const { values, ...manifest } = bundle;
          // Preserve coordinator data together with previous documents; restoring only
          // KV would let the next alarm immediately republish the broken state.
          const previous = await this.store.get('bundle-manifest');
          if (previous) await this.store.put('previous-bundle-manifest', previous);
          await this.store.put('previous-coordinator-state', rollbackState);
          await this.store.put('previous-master', rollbackMaster);
          await this.store.put('previous-public-page', page || null);
          const previousKeys = [];
          for (const fact of rollbackFacts) {
            const key = `previous-fact:${await hash([factKey(fact), fact.startsOn])}`;
            await this.store.put(key, fact); previousKeys.push(key);
          }
          await this.store.put('previous-fact-keys', previousKeys);
          await this.store.put('pending-bundle', { ...manifest, step: 0 });
          await this.store.put('previous-publication', publication || null);
        }
        await this.store.put('master', master);
        state.candidateRevision = revision;
      }
      // Finish an older write-ahead record during the upgrade, through both channels.
      const legacyPending = await this.store.get('pending-publication');
      if (legacyPending && !await this.store.get('pending-bundle')) {
        const bundle = await createBundle(legacyPending, await this.env.CONTENT_KV.get('weekly:public', 'json'), now);
        for (let i = 0; i < bundle.values.length; i++) await this.store.put(`bundle:${bundle.revision}:${i}`, bundle.values[i]);
        const { values, ...manifest } = bundle;
        await this.store.put('pending-bundle', { ...manifest, step: 0 });
      }
      const pending = await this.store.get('pending-bundle');
      if (pending && this.env.PUBLICATION_MODE === 'publish') {
        // The old current edition may never have had its own article key. Keep
        // every link in the new index readable before exposing that index.
        if (!pending.archivesSaved) {
          const oldPage = await this.store.get('previous-public-page');
          const oldEditions = oldPage?.current ? [oldPage.current] : oldPage?.editions || (oldPage?.issue ? [oldPage] : []);
          for (const edition of oldEditions.filter(e => e.endsOn < pending.weekId)) {
            const key = `weekly:public:${edition.issue}`;
            if (!await this.env.CONTENT_KV.get(key)) await this.env.CONTENT_KV.put(key, JSON.stringify(edition));
          }
          pending.archivesSaved = true;
          await this.store.put('pending-bundle', pending);
        }
        for (let i = pending.step; i < pending.writes.length; i++) {
          const payload = await this.store.get(`bundle:${pending.revision}:${i}`);
          if (!payload || await hash(payload) !== pending.writes[i].digest) throw new Error('publication_bundle_corrupted');
          await this.env.CONTENT_KV.put(pending.writes[i].key, JSON.stringify(payload));
          pending.step = i + 1;
          await this.store.put('pending-bundle', pending);
        }
        const snapshot = await this.store.get(`bundle:${pending.revision}:1`);
        await this.store.put('publication', snapshot);
        await this.store.put('bundle-manifest', pending);
        await this.queueHistory(snapshot);
        await this.store.delete('pending-bundle');
        await this.store.delete('pending-publication');
        state.publishedRevision = pending.revision;
        state.lastPublishedAt = new Date(now).toISOString();
        state.verifyAfter = now + 75_000;
        state.verifiedRevision = null;
      }
      const publication = await this.store.get('publication');
      const manifest = await this.store.get('bundle-manifest');
      if (publication && manifest && state.verifiedRevision !== publication.revision && state.verifyAfter <= now) {
        // Independent live read: Pages reads both KV documents without exposing the
        // protected payload. This receipt is compared before freshness can turn green.
        const response = await safeFetch(`https://gtacompanion.net/api/content-status?revision=${publication.revision}`);
        if (!response.ok) throw new Error(`content_status_http_${response.status}`);
        const live = JSON.parse(await readBounded(response, 12000));
        if (live.app?.revision !== publication.revision || live.public?.revision !== publication.revision || live.article?.revision !== publication.revision || live.reasons?.includes('channels_diverged')) throw new Error('publication_propagating');
        const token = await this.store.get('smoke-token');
        if (token) {
          const api = await safeFetch(`https://gtacompanion.net/api/weekly?revision=${publication.revision}`, { headers: { authorization: `Bearer ${token}` } });
          if (!api.ok) throw new Error(`weekly_api_http_${api.status}`);
          const actual = JSON.parse(await readBounded(api, 150000));
          if (await hash(actual) !== await hash(projectContent(publication, Date.now()))) throw new Error('weekly_api_content_mismatch');
        }
        const publicApi = await safeFetch(`https://gtacompanion.net/api/weekly-public?revision=${publication.revision}`);
        if (!publicApi.ok) throw new Error(`public_api_http_${publicApi.status}`);
        const publicLive = JSON.parse(await readBounded(publicApi, 150000));
        if (publicLive.revision !== publication.revision) throw new Error('public_api_propagating');
        state.verifiedRevision = publication.revision;
        state.lastVerifiedAt = new Date().toISOString();
        await this.queueHistory(publication, state.lastVerifiedAt);
      }
      const currentWeek = thursdayWeekId(new Date(now));
      const expectedAt = atLocal(currentWeek, 11 * 60);
      state.sectionCoverage = inspectSectionCoverage(publication, await this.store.get('section-evidence'), now, currentWeek, expectedAt);
      state.sectionCoverage.revision = publication?.revision || null;
      await this.env.CONTENT_KV.put('weekly:receipt', JSON.stringify({ weekId: publication?.weekId || null,
        publishedRevision: state.publishedRevision || null, verifiedRevision: state.verifiedRevision || null,
        verifiedAt: state.lastVerifiedAt || null, lastRunAt: new Date(now).toISOString(), sectionCoverage: state.sectionCoverage }));
      const missing = !master || master.weekId < currentWeek || !projectContent(master, now).sections.filter(s => !['gta-plus', 'dlc'].includes(s.id)).flatMap(s => s.items).some(i => Date.parse(i.startsAt) >= expectedAt && Date.parse(i.expiresAt) <= atLocal(new Date(Date.parse(currentWeek) + 7 * DAY).toISOString().slice(0, 10), 660));
      state.awaitingOfficial = !state.sources?.some(s => s.kind === 'rockstar' && s.scope === 'weekly' && s.current && s.facts > 0);
      state.pending = missing || state.awaitingOfficial;
      state.expectedAt = new Date(expectedAt).toISOString();
      state.incidents = [];
      if (state.sectionCoverage.alarm) state.incidents.push({ key:'section-completeness', reason:`Niepotwierdzone wymagane obszary wydania: ${state.sectionCoverage.unresolved.join(', ')}`, since:state.sectionCoverage.deadlineAt });
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
      if (state.pending) state.nextCheck.at = Math.min(state.nextCheck.at, now + 15 * MINUTE);
      // Re-project and confirm the publication on a natural alarm at least every
      // 15 minutes. Source checks retain their separate budgeted schedule.
      nextAt = Math.min(state.nextCheck.at, now + 15 * MINUTE);
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
