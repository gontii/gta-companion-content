import { factKey, factWindow } from './facts.mjs';
import { offerTraits } from './offer-traits.mjs';

// A dated website supplies the calendar window. A current video can corroborate
// the exact offer, never manufacture dates from its upload timestamp.
export function needsTranscriptSupplement(documents, approved, now) {
  const accepted = new Set(approved.map(f => factKey(f) + ':' + f.startsOn + ':' + JSON.stringify(offerTraits(f))));
  return documents.filter(d => d.current).flatMap(d => d.facts).some(f => {
    const window = factWindow(f);
    return now >= Date.parse(window.startsAt) && now < Date.parse(window.expiresAt) &&
      offerTraits(f) && !accepted.has(factKey(f) + ':' + f.startsOn + ':' + JSON.stringify(offerTraits(f)));
  });
}

export function corroborateGunVanTranscript(video, chunks, documents) {
  const text = chunks.map(c => c.text).join(' ');
  const facts = [];
  // Both clauses explicitly name membership and percentage. Do not use a bare
  // weapon mention, speech about another store, or the video's publication date.
  for (const match of text.matchAll(/(?:everyone|all players|GTA\s*(?:Plus|\+)\s+members)\s+(?:will\s+)?get\s+(\d+)%\s+off\s+(?:the\s+)?([A-Za-z -]+?)(?=[.!?]|\s+and\b)/gi)) {
    const preceding = text.slice(Math.max(0, match.index - 180), match.index);
    if (!/gun van/i.test(preceding)) continue;
    const eligibility = /^GTA/i.test(match[0]) ? 'gta-plus' : 'all';
    const spoken = match[2].trim().toLowerCase();
    const entity = spoken === 'emp launcher' ? 'compact emp launcher' : spoken;
    for (const doc of documents.filter(d => d.current && d.source.kind !== 'tgg')) {
      for (const f of doc.facts) {
        const trait = offerTraits(f);
        const uploaded = Date.parse(video.publishedOn), start = Date.parse(f.startsOn);
        if (f.section !== 'gun-van' || f.entity.toLowerCase() !== entity || f.eligibility !== eligibility ||
            trait?.type !== 'discount' || trait.amount !== Number(match[1]) || !['', 'at the gun van'].includes(trait.requirements) ||
            !Number.isFinite(uploaded) || uploaded < start - 86400000 || uploaded > start + 2 * 86400000 ||
            Date.parse(f.endsOn) - start !== 6 * 86400000) continue;
        const prefix = text.slice(0, match.index);
        let length = 0, offsetMs = 0;
        for (const chunk of chunks) { if (length > prefix.length) break; offsetMs = chunk.offset; length += chunk.text.length + 1; }
        facts.push({ ...f, offsetMs, transcriptEvidence: match[0], sources: [{ ...video, offsetMs }] });
      }
    }
  }
  return [...new Map(facts.map(f => [factKey(f) + ':' + f.startsOn, f])).values()];
}
