import { hash } from './facts.mjs';
import { projectContent } from './temporal.mjs';
import { safeFetch } from './http.mjs';
export async function verifyAppRender(live, publication, now = Date.now()) {
  const proof = live.appRender;
  const renderedAt = Date.parse(proof?.renderedAt);
  if (proof?.schemaVersion !== 1 || proof.algorithm !== 'sha256' || proof.revision !== publication.revision || !Number.isFinite(renderedAt) || Math.abs(now - renderedAt) > 60000) throw new Error('weekly_render_proof_invalid');
  if (proof.digest !== await hash(projectContent(publication, renderedAt))) throw new Error('weekly_render_content_mismatch');
  // Kontrola publikacji nie udaje zalogowanego użytkownika. Osobno dowodzimy bramki API.
  const denied = await safeFetch('https://gtacompanion.net/api/weekly');
  if (denied.status !== 401) throw new Error(`weekly_auth_gate_http_${denied.status}`);
  return { mode: 'render-digest-v1', checkedAt: new Date(now).toISOString(), unauthenticatedStatus: denied.status, digest: proof.digest };
}
