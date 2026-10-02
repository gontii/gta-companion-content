import { stripTags } from './weekly-core.mjs';
import { validateFacts } from './facts.mjs';

// Narrow, cost-free extraction from explicit rotation sections. Unknown formats
// supply no facts; headings, dates and acquisition conditions remain evidence.
export function extractWeeklyRotations(doc) {
  if (!['intel', 'igta', 'gtaboss', 'reddit'].includes(doc.source.kind) || !doc.period) return { facts: [], rejected: [] };
  const text = stripTags(doc.html);
  const dates = doc.periodEvidence || doc.text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:[-–—]|to|through)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?/i)?.[0];
  if (!dates) return { facts: [], rejected: [] };
  const raw = [];
  const make = (section, entity, offer, evidence) => raw.push({ section, entity, offer, evidence,
    dateEvidence: dates, eligibility: 'all', platform: 'all', startsOn: doc.period.startId, endsOn: doc.period.endId });
  // Both formats explicitly identify the Lucky Wheel prize. A podium vehicle is
  // a chance to win, never a guaranteed free vehicle or a Prize Ride challenge.
  const podiumBlock = doc.html.match(/<h[1-6][^>]*>\s*(?:Podium Vehicle|The Diamond Casino and Resort Lucky Wheel:)\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i);
  if (podiumBlock) {
    const block = stripTags(podiumBlock[1]);
    const chance = /(?:lucky wheel[\s\S]{0,60}chance to win the\s+)([A-Z][A-Za-z0-9’' -]+?)(?=,|\s+which\b)/i.exec(block);
    const listed = doc.source.kind === 'igta' && /^\s*([A-Z][A-Za-z0-9’' -]+?)\s*\([^)]{1,40}\)/.exec(block);
    const entity = chance?.[1]?.trim() || listed?.[1]?.trim();
    if (entity) make('free-vehicles', entity, 'Podium vehicle: chance to win at the Lucky Wheel; winning is not guaranteed',
      chance ? chance[0] : `The Diamond Casino and Resort Lucky Wheel: ${listed[0].trim()}`);
  }
  const prize = /place top (\d+) in (?:a |an |the )?LS Car Meet (?:Race|Series) for (\d+|one|two|three|four|five|six|seven) days in a row to (?:unlock|win) (?:the )?([A-Z][A-Za-z0-9’' -]+?)(?= as | \(|\. |\.?$)/i.exec(text);
  if (prize) make('free-vehicles', prize[3].trim(), prize[0], prize[0]);
  const stockSection = doc.html.match(/<h[1-6][^>]*>\s*Gun Van(?: Contents| Inventory)?\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i)?.[1];
  const stock = (stockSection ? stripTags(stockSection) : null) || /Gun Van (?:Contents|Inventory)([\s\S]*?)(?=Premium Race|Rotating Content|Gun Van exclusive|$)/i.exec(text)?.[1];
  if (stock) for (const entity of ['Knife', 'Combat Shotgun', 'Precision Rifle', 'Pipe Bombs', 'Railgun', 'Stun Gun', 'Heavy Rifle', 'Grenade Launcher', 'Vintage Pistol', 'Nightstick', 'Baseball Bat', 'The Shocker', 'Service Carbine', 'Widowmaker', 'Up-n-Atomizer', 'Unholy Hellbringer', 'Tactical SMG', 'Battle Rifle', 'Compact EMP Launcher', 'Heavy Sniper', 'Pump Shotgun', 'Pipe Wrench', 'Assault Shotgun', 'Combat MG', 'SMG', 'Micro SMG', 'Carbine Rifle', 'Sniper Rifle', 'Molotovs', 'Grenades', 'Sticky Bombs', 'Tear Gas', 'Proximity Mines', 'Super Light Armor', 'Light Armor', 'Standard Armor', 'Heavy Armor', 'Super Heavy Armor']) {
    const names = entity.replaceAll(' ', '\\s+');
    const match = [...stock.matchAll(new RegExp(`(?<![\\w-])${names}(?![\\w-])`, 'gi'))].find(candidate =>
      !(['SMG', 'Carbine Rifle', 'Sniper Rifle', 'Light Armor', 'Heavy Armor', 'Grenades'].includes(entity) &&
        /(?:Tactical|Micro|Service|Heavy|Super|Sticky)\s*$/i.test(stock.slice(0, candidate.index))));
    if (match) make('gun-van', entity, 'In stock', match[0]);
  }
  // Only the explicit regular/GTA+ pair supplies two discount facts. Bare stock
  // lists, price tables and unknown platform restrictions cannot establish them.
  if (stockSection && doc.source.kind === 'intel') for (const [, row] of stockSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const evidence = stripTags(row);
    const pair = /^([A-Za-z][A-Za-z0-9’' -]+)\s*\((\d{1,2})%,\s*GTA\+\s*(\d{1,2})%\)$/.exec(evidence);
    if (!pair || pair[1].trim() === 'El Strickler') continue;
    const entity = pair[1].trim();
    if (!raw.some(f => f.section === 'gun-van' && f.entity === entity && f.offer === 'In stock')) continue;
    if (+pair[2] <= 0 || +pair[3] <= 0) continue;
    make('gun-van', entity, `${pair[2]}% off at the Gun Van`, `${entity} (${pair[2]}%`);
    raw.push({ ...raw.at(-1), offer: `${pair[3]}% off at the Gun Van`, eligibility: 'gta-plus', evidence });
  }
  // El Strickler's platform restriction is not established by a bare stock list.
  return validateFacts({ facts: raw }, doc);
}
