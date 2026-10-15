// Ścisła tożsamość zadania: warunki, nagroda, okres i uprawnienia.
// Nie stosujemy podobieństwa nazw ani rozmytego łączenia różnych aktywności.
const numbers = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
export const objectiveText = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/(?<=\d)[, ](?=\d{3}\b)/g, '')
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, word => numbers[word])
  .replace(/[^a-z0-9$]+/g, ' ').trim().replace(/\s+/g, ' ');
export function objectiveParts(item) {
  const offer = String(item.offer || item.label || '').replace(/^Week \d+\/\d+:\s*/i, '');
  const match = /^(.*?)\s+to\s+(?:receive|earn|win|unlock|claim)\s+(.+?)(?:\.\s|\.$|$)/i.exec(offer);
  if (!match || !/^(?:win|complete|finish|secure|collect|sell|deliver|place)\b/i.test(match[1])) return null;
  const action = objectiveText(match[1]);
  // Kolejność wypisania gotówki i przedmiotu nie zmienia nagrody.
  const reward = objectiveText(match[2]).split(' ').filter(w => !['the','a','an','and','extra'].includes(w)).sort().join(' ');
  return { action, reward };
}
export function objectiveKey(item) {
  const parts = objectiveParts(item);
  if (!parts) return null;
  return JSON.stringify([parts.action, parts.reward, item.startsAt, item.expiresAt,
    item.eligibility || 'all', item.platform || 'all']);
}
const verified = item => ['official','corroborated'].includes(item.confidence) ||
  (item.confidence === 'editorial' && item.sources?.some(s => s.kind === 'rockstar'));
export function duplicateObjectives(content) {
  const seen = new Map(), duplicates = [];
  for (const section of content.sections) for (const item of section.items) {
    if (!verified(item)) continue;
    const key = objectiveKey(item);
    if (!key) continue;
    if (seen.has(key)) duplicates.push([seen.get(key), item]);
    else seen.set(key, item);
  }
  return duplicates;
}
export function deduplicateObjectives(content) {
  const groups = new Map(), aliases = new Map();
  const rank = item => (item.seasonalEventId ? 8 : 0) + (item.editorial ? 4 : 0) +
    (item.confidence === 'official' ? 2 : 0) + (item.progressGroup === 'primary' ? 1 : 0);
  for (const section of content.sections) for (const item of section.items) {
    if (!verified(item)) continue;
    const key = objectiveKey(item);
    if (!key) continue;
    const previous = groups.get(key);
    if (!previous || rank(item) > rank(previous)) groups.set(key, item);
  }
  for (const section of content.sections) section.items = section.items.filter(item => {
    const kept = verified(item) && groups.get(objectiveKey(item));
    if (!kept || kept === item) return true;
    aliases.set(item.id, kept.id);
    return false;
  });
  // Powiązane wskazówki wskazują na zachowaną tożsamość zadania.
  for (const list of [content.beginnerPath, content.quickTakeEntries, content.locations])
    for (const entry of list || []) if (entry.itemIds)
      entry.itemIds = [...new Set(entry.itemIds.map(id => aliases.get(id) || id))];
  return content;
}
