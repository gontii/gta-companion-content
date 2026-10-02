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
  const prize = /place top (\d+) in (?:a |an |the )?LS Car Meet (?:Race|Series) for (\d+|one|two|three|four|five|six|seven) days in a row to (?:unlock|win) (?:the )?([A-Z][A-Za-z0-9’' -]+?)(?= as | \(|\. |\.?$)/i.exec(text);
  if (prize) make('free-vehicles', prize[3].trim(), prize[0], prize[0]);
  const stockSection = doc.html.match(/<h[1-6][^>]*>\s*Gun Van\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i)?.[1];
  const stock = (stockSection ? stripTags(stockSection) : null) || /Gun Van (?:Contents|Inventory)([\s\S]*?)(?=Premium Race|Rotating Content|Gun Van exclusive|$)/i.exec(text)?.[1];
  if (stock) for (const entity of ['Knife', 'Combat Shotgun', 'Precision Rifle', 'Pipe Bombs', 'Railgun', 'Stun Gun', 'Heavy Rifle', 'Grenade Launcher', 'Vintage Pistol', 'Nightstick', 'Baseball Bat', 'The Shocker', 'Service Carbine', 'Widowmaker', 'Up-n-Atomizer', 'Unholy Hellbringer', 'Tactical SMG', 'Battle Rifle', 'Compact EMP Launcher', 'Heavy Sniper', 'Pump Shotgun', 'Pipe Wrench', 'Assault Shotgun', 'Combat MG', 'SMG', 'Micro SMG', 'Carbine Rifle', 'Sniper Rifle', 'Molotovs', 'Grenades', 'Sticky Bombs', 'Tear Gas', 'Proximity Mines', 'Super Light Armor', 'Light Armor', 'Standard Armor', 'Heavy Armor', 'Super Heavy Armor']) {
    const names = entity.replaceAll(' ', '\\s+');
    const match = new RegExp(`(?<![\\w-])${names}(?![\\w-])`, 'i').exec(stock);
    if (match && ['SMG', 'Carbine Rifle', 'Sniper Rifle', 'Light Armor', 'Heavy Armor', 'Grenades'].includes(entity) && /(?:Tactical|Micro|Service|Heavy|Super|Sticky)\s*$/i.test(stock.slice(0, match.index))) continue;
    if (match) make('gun-van', entity, 'In stock', match[0]);
  }
  // El Strickler's platform restriction is not established by a bare stock list.
  return validateFacts({ facts: raw }, doc);
}
