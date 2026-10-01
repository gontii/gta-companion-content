import { atLocal, localParts, addDays, projectContent } from './temporal.mjs';
import { validatePublicPage } from '../schemas/public-weekly.mjs';
export function inspectContentStatus({ app, page, article, receipt }, now = Date.now()) {
  const today = localParts(now).date;
  const weekday = new Date(today+'T12:00:00Z').getUTCDay();
  let expectedWeek = addDays(today, -((weekday + 3) % 7));
  let expectedAt = atLocal(expectedWeek, 660);
  if (now < expectedAt) { expectedWeek = addDays(expectedWeek, -7); expectedAt = atLocal(expectedWeek, 660); }
  const summary = value => value ? { weekId: value.weekId, revision: value.revision || null, startsAt: value.startsAt || null, expiresAt: value.expiresAt || null } : null;
  const reasons = [];
  let edition;
  try { validatePublicPage(page, now); edition = page.current || page.editions?.find(d => d.weekId === expectedWeek) || page.editions?.[0] || page; }
  catch { reasons.push('public_document_invalid'); }
  let projected;
  try { projected = app && projectContent(app, now); } catch { reasons.push('app_document_invalid'); }
  const appFacts = projected?.sections?.filter(s => s.id !== 'gta-plus').flatMap(s => s.items) || [];
  const currentApp = app?.weekId === expectedWeek && now >= Date.parse(app.startsAt) && now < Date.parse(app.expiresAt) && appFacts.length > 0;
  const publicFacts = edition?.sections?.filter(s => s.id !== 'gta-plus').flatMap(s => s.items).filter(i => i.status === 'confirmed' && i.startsAt && now >= Date.parse(i.startsAt) && now < Date.parse(i.expiresAt)) || [];
  const currentPublic = edition?.weekId === expectedWeek && edition.status === 'active' && publicFacts.length > 0 && now < Date.parse(edition.expiresAt);
  if (!currentApp) reasons.push('app_week_not_current');
  if (!currentPublic) reasons.push('public_week_not_current');
  const commonApp = app?.sections?.filter(s => s.id !== 'dlc').flatMap(s => s.items).map(i => [i.id, i.label, i.startsAt, i.expiresAt]).sort((a,b) => a[0].localeCompare(b[0]));
  const commonPublic = edition?.sections?.flatMap(s => s.items).filter(i => i.status === 'confirmed').map(i => [i.id, i.offer, i.startsAt, i.expiresAt]).sort((a,b) => a[0].localeCompare(b[0]));
  const both = !!app?.revision && app.revision === edition?.revision && article?.revision === edition?.revision && JSON.stringify(commonApp) === JSON.stringify(commonPublic) && JSON.stringify(article) === JSON.stringify(edition);
  if (!both) reasons.push('channels_diverged');
  const checked = receipt?.verifiedRevision === app?.revision && receipt?.weekId === expectedWeek && Number.isFinite(Date.parse(receipt?.verifiedAt));
  if (!checked) reasons.push('publication_not_verified');
  const current = !!(currentApp && currentPublic && both && checked);
  const grace = now < expectedAt + 15 * 60000;
  return { schemaVersion: 1, checkedAt: new Date(now).toISOString(), expectedWeek, expectedAt: new Date(expectedAt).toISOString(),
    app: summary(app), public: summary(edition), article: summary(article), verifiedRevision: receipt?.verifiedRevision || null,
    verifiedAt: receipt?.verifiedAt || null, lastRunAt: receipt?.lastRunAt || null,
    current, alarm: !current && !grace, reasons, completeness: app?.completeness || 'pending' };
}
