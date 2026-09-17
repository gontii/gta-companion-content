import reviewed from '../events/reviewed-weekly-2638.json' with { type: 'json' };
import { factKey, factWindow } from './facts.mjs';

// Zatwierdzone uzupełnienie wydania 2638. Wypełnia braki, nie nadpisuje
// istniejących korekt ani świeższych faktów dostarczonych przez źródła.
export function supplementReviewedFacts(master, facts, now) {
  const keys = new Set(facts.map(factKey));
  const existing = master?.sections?.flatMap(s => s.items) || [];
  const additions = reviewed.filter(f => {
    const window = factWindow(f);
    if (now < Date.parse(window.startsAt) || now >= Date.parse(window.expiresAt)) return false;
    if (keys.has(factKey(f))) return false;
    return !existing.some(i => i.factKey === factKey(f) && Date.parse(i.expiresAt) > now);
  });
  return [...facts, ...additions];
}
