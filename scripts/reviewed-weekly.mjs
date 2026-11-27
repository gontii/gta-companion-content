import previous from '../events/reviewed-weekly-2638.json' with { type: 'json' };
import current from '../events/reviewed-weekly-2640.json' with { type: 'json' };
import latest from '../events/reviewed-weekly-2641.json' with { type: 'json' };
import week2644 from '../events/reviewed-weekly-2644.json' with { type: 'json' };
import week2645 from '../events/reviewed-weekly-2645.json' with { type: 'json' };
import week2646 from '../events/reviewed-weekly-2646.json' with { type: 'json' };
import week2647 from '../events/reviewed-weekly-2647.json' with { type: 'json' };
import week2648 from '../events/reviewed-weekly-2648.json' with { type: 'json' };
const corrections = [...current, ...latest, ...week2644, ...week2645, ...week2646, ...week2647, ...week2648];
const reviewed = [...previous, ...corrections];
import { factKey, factWindow, normal } from './facts.mjs';

// Zatwierdzone uzupełnienie wydania 2638. Wypełnia braki, nie nadpisuje
// istniejących korekt ani świeższych faktów dostarczonych przez źródła.
export function supplementReviewedFacts(master, facts, now) {
  // Potwierdzona korekta wygrywa z ponowną ekstrakcją tego samego okresu.
  const active = corrections.filter(f => now >= Date.parse(factWindow(f).startsAt) && now < Date.parse(factWindow(f).expiresAt));
  const corrected = new Set(active.map(f => factKey(f) + ':' + f.startsOn));
  facts = facts.filter(f => !corrected.has(factKey(f) + ':' + f.startsOn));
  // Two sources reverse this same Bail Office name. Do not publish it twice.
  facts = facts.filter(f => !(f.section === 'bonuses' && normal(f.entity) === 'bail office standard and most wanted targets' &&
    active.some(a => a.section === f.section && normal(a.entity) === 'standard and most wanted bail office targets' && a.eligibility === f.eligibility)));
  const keys = new Set(facts.map(factKey));
  const existing = master?.sections?.flatMap(s => s.items) || [];
  const additions = reviewed.filter(f => {
    const window = factWindow(f);
    if (now < Date.parse(window.startsAt) || now >= Date.parse(window.expiresAt)) return false;
    if (keys.has(factKey(f))) return false;
    return !existing.some(i => i.factKey === factKey(f) && Date.parse(i.expiresAt) > now);
  });
  return [...facts, ...additions.filter(f => !corrections.includes(f)), ...active];
}

// Wersja aplikacji obsługuje cytowania RockstarINTEL, ale nie drugi serwis.
// Drugie źródło pozostaje w dokumencie publicznym i odbiorze redakcyjnym.
// Naprawia również kopię uzupełnienia już przechowywaną przez automat.
export function normalizeReviewedSources(master) {
  if (!master) return master;
  const unsupported = 'https://www.igrandtheftauto.com/gtaonline/news/this-week-in-gta-online-september-17-2026';
  return JSON.parse(JSON.stringify(master, (key, value) =>
    key === 'sources' && Array.isArray(value) ? value.filter(s => s.url !== unsupported) : value));
}

// Older apps link to the edition for reviewed rows whose two citations
// are only supported in the public article.
export function hasReviewedEditionSources(item, weekId) {
  return week2648.some(f => f.startsOn === weekId && factKey(f) === item.factKey &&
    f.offer === item.offer && f.sources.length >= 2 &&
    f.sources.every(source => item.sources?.some(s => s.url === source.url)));
}
