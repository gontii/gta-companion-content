// Only known exact syntax is normalized. Unknown prose cannot establish agreement.
const canonical = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/(?<=\d)[, ](?=\d{3}\b)/g, '').replace(/&/g, ' and ')
  .replace(/\bdouble\b/g, '2x').replace(/\btriple\b/g, '3x')
  .replace(/\s+/g, ' ').replace(/[.!]+$/, '').trim();
export function offerTraits(f) {
  const text = canonical(f.offer);
  let match = /^(\d+(?:\.\d+)?)\s*x\s+(gta\$(?:\s+and\s+rp)?|rp)(.*)$/.exec(text);
  if (match) return { type: 'multiplier', amount: Number(match[1]), units: match[2].includes('rp') ? match[2].includes('gta$') ? ['GTA$', 'RP'] : ['RP'] : ['GTA$'], requirements: match[3].trim() };
  match = /^(\d+(?:\.\d+)?)\s*%\s*(?:off|discount)(.*)$/.exec(text);
  if (match) return { type: 'discount', amount: Number(match[1]), requirements: match[2].trim() };
  match = /^(?:free|at no cost|complimentary)(.*)$/.exec(text);
  if (match) return { type: 'free', requirements: match[1].trim() };
  if (text === 'in stock') return { type: 'availability' };
  match = /^place top (\d+) in (?:a |an |the )?ls car meet (?:race|series) for (\d+|one|two|three|four|five|six|seven) days in a row to (?:win|unlock) (?:the )?(.+)$/.exec(text);
  if (match) {
    const count = Number(match[2]) || ({one:1,two:2,three:3,four:4,five:5,six:6,seven:7})[match[2]];
    const reward = match[3].replace(/ as the prize ride vehicle$/, '').trim();
    return { type: 'prize-ride', rank: Number(match[1]), count, consecutive: true, activity: 'LS Car Meet', reward };
  }
  // Acquisition conditions, rank/count, consecutive days, claim windows, membership
  // and platform remain exact. No edit distance, substring or language-model voting.
  return null;
}
export function factSignature(f) {
  const traits = offerTraits(f);
  if (!traits) return null;
  return JSON.stringify([f.section, canonical(f.entity), f.eligibility, f.platform, f.startsOn, f.endsOn, f.timing || null, traits]);
}
