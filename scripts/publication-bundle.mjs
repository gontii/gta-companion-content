import { hash, validateSnapshot } from './facts.mjs';
import { parseWeeklyContent } from '../schemas/app-weekly-parser.mjs';
import { validatePublicWeekly, validatePublicPage, issueNumber, SECTIONS, PLATFORMS } from '../schemas/public-weekly.mjs';
import { localParts, addDays } from './temporal.mjs';
const sections = { bonuses: 'bonuses', challenge: 'rewards', 'free-vehicles': 'rewards', discounts: 'discounts', 'gun-van': 'rotations', other: 'events', 'gta-plus': 'gta-plus' };
const period = item => ({ startsOn: localParts(Date.parse(item.startsAt)).date,
  endsOn: addDays(localParts(Date.parse(item.expiresAt)).date, item.timingConfidence === 'confirmed' && localParts(Date.parse(item.expiresAt)).minutes > 0 ? 0 : -1) });
export function publicEdition(snapshot, now) {
  validateSnapshot(snapshot, { published: true });
  if (!parseWeeklyContent(snapshot)) throw new Error('app_parser_rejected');
  const sources = new Map();
  const rows = Object.fromEntries(Object.keys(SECTIONS).map(id => [id, []]));
  for (const section of snapshot.sections.filter(s => s.id !== 'dlc')) for (const item of section.items) {
    if (!sections[section.id]) throw new Error('public_section_unknown');
    const sourceIds = (item.sources || snapshot.sources || []).map(source => {
      if (!sources.has(source.url)) sources.set(source.url, { id: `ref-${sources.size + 1}`, title: source.kind === 'rockstar' ? 'Rockstar Games Newswire' : source.kind === 'intel' ? 'RockstarINTEL' : source.kind === 'gtabase' ? 'GTABase' : 'Source', url: source.url, verifiedAt: snapshot.generatedAt });
      return sources.get(source.url).id;
    });
    if (!sourceIds.length) throw new Error('public_item_source_missing');
    const gtaPlus = section.id === 'gta-plus' || item.eligibility === 'gta-plus';
    const target = gtaPlus ? 'gta-plus' : sections[section.id];
    rows[target].push({ id: item.id, name: (item.entity || item.label.split(' — ')[0]).slice(0, 150).trim(), status: 'confirmed',
      offer: item.label, requirements: 'The conditions and platform restrictions stated in the offer apply.',
      ...period(item), ...(item.targetCount ? { targetCount: item.targetCount } : {}), startsAt: item.startsAt, expiresAt: item.expiresAt, claim: null, gtaPlus, sourceIds: [...new Set(sourceIds)] });
  }
  for (const [id, items] of Object.entries(rows)) {
    if (!items.length) items.push({ id: `pending-${id}`, name: `${SECTIONS[id]} details`, status: 'pending', offer: null, requirements: null,
      startsOn: null, endsOn: null, claim: null, gtaPlus: id === 'gta-plus', sourceIds: [] });
    // A populated category does not establish that unknown rotations or offers are absent.
    else if (id === 'rotations') {
      items.push({ id: 'pending-gun-van-stock', name: 'Other Gun Van stock and discounts', status: 'pending', offer: null, requirements: null, startsOn: null, endsOn: null, claim: null, gtaPlus: false, sourceIds: [] });
      items.push({ id: 'pending-prize-vehicles', name: 'Podium and Prize Ride requirements', status: 'pending', offer: null, requirements: null,
      startsOn: null, endsOn: null, claim: null, gtaPlus: false, sourceIds: [] });
    }
  }
  const edition = { schemaVersion: 1, issue: issueNumber(snapshot.weekId), weekId: snapshot.weekId, startsOn: snapshot.weekId,
    endsOn: addDays(snapshot.weekId, 6), status: now >= Date.parse(snapshot.startsAt) ? 'active' : 'preview',
    verifiedAt: snapshot.generatedAt, confirmedAt: now >= Date.parse(snapshot.startsAt) ? snapshot.generatedAt : null,
    startsAt: snapshot.startsAt, expiresAt: snapshot.expiresAt, revision: snapshot.revision,
    platforms: PLATFORMS, sections: Object.entries(rows).map(([id, items]) => ({ id, items })), sources: [...sources.values()] };
  validatePublicWeekly(edition, now);
  const actual = edition.sections.flatMap(s => s.items).filter(i => i.status === 'confirmed');
  if (actual.length !== snapshot.sections.filter(s => s.id !== 'dlc').flatMap(s => s.items).length || actual.some(i => !snapshot.sections.filter(s => s.id !== 'dlc').flatMap(s => s.items).some(a => a.id === i.id && a.label === i.offer && a.startsAt === i.startsAt && a.expiresAt === i.expiresAt))) throw new Error('public_app_fact_mismatch');
  return edition;
}
export async function createBundle(snapshot, existingPage, now) {
  const edition = publicEdition(snapshot, now);
  if (existingPage) validatePublicPage(existingPage, now);
  const oldEditions = existingPage?.current ? [existingPage.current] : existingPage?.editions || (existingPage?.issue ? [existingPage] : []);
  const archive = [...(existingPage?.archive || []), ...oldEditions.filter(d => d.endsOn < edition.startsOn).map(({ issue, startsOn, endsOn }) => ({ issue, startsOn, endsOn }))];
  const page = { schemaVersion: 2, current: edition, archive: [...new Map(archive.map(e => [e.issue, e])).values()].sort((a,b) => b.startsOn.localeCompare(a.startsOn)) };
  validatePublicPage(page, now);
  const writes = [{ key: `weekly:public:${edition.issue}`, value: edition }, { key: 'weekly:latest', value: snapshot }, { key: 'weekly:public', value: page }];
  const hashes = await Promise.all(writes.map(w => hash(w.value)));
  return { revision: snapshot.revision, weekId: snapshot.weekId, issue: edition.issue, preparedAt: snapshot.generatedAt,
    writes: writes.map((w,i) => ({ key: w.key, digest: hashes[i] })), values: writes.map(w => w.value) };
}
