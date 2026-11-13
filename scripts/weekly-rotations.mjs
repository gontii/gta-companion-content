import { stripTags, extractDateRange } from './weekly-core.mjs';
import { validateFacts } from './facts.mjs';

const DAY_WORD = '(\\d+|one|two|three|four|five|six|seven)';
const VEHICLE = "([A-ZÀ-ž][A-Za-zÀ-ž0-9’' -]+?)";
const CLASS_SUFFIX = /\s*\((?:Sports Classic|Sports|Super|Muscle|Sedan|Coupe|SUV|Off-Road|Motorcycle|Industrial|Military|Plane|Compact|Utility|Van|Service|Emergency|Open Wheel|Commercial|Helicopter|Cycle)\)\s*$/i;
const bareName = value => String(value || '').replace(/[.!]+$/, '').replace(CLASS_SUFFIX, '').replace(/\s+[-–—]\s*NEW\s*$/i, '').trim();
const BONUS_SPAN_DAYS = 62;

// Multiplier rows state their own window, or inherit one from the heading
// above them. A later window must not be rewritten as the current GTA week.
export function extractDatedBonuses(doc, fallbackEvidence = '') {
  if (!doc?.period || !doc.html) return [];
  const anchor = { publishedWeekId: doc.period.startId, now: new Date(`${doc.period.startId}T12:00:00Z`), maxSpanDays: BONUS_SPAN_DAYS };
  const rows = [];
  let heading = null;
  for (const match of doc.html.matchAll(/<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    const evidence = stripTags(match[2].replace(/<(?:ul|ol)\b[\s\S]*$/i, ''));
    if (tag.startsWith('h')) {
      const parsed = extractDateRange(evidence, anchor);
      heading = parsed ? { ...parsed, dateEvidence: parsed.quote || evidence } : null;
      continue;
    }
    const bonus = /^(\d+)x\s+GTA\$(.*?)\s+(?:on|[-–—])\s+(.+)$/i.exec(evidence);
    if (!bonus || evidence.length > 650) continue;
    const hasRp = /\bRP\b/i.test(bonus[2]);
    const tail = bonus[3];
    const entity = bareName(tail.split(/\s*(?:\(|, increased| for GTA\+|\(\d+x)/i)[0]).replace(/:\s*$/, '');
    if (!entity) continue;
    const memberBoost = /(?:increased to |\()(\d+)x (?:for )?GTA\+ Members/i.exec(tail);
    const memberOnly = !memberBoost && /for GTA\+ Members$/i.test(tail);
    const allEvidence = /GTA\+/i.test(evidence) ? evidence.split(/, increased|\s*\((?=[^)]*GTA\+)/i)[0] : evidence;
    const own = extractDateRange(evidence, anchor);
    const period = own || heading;
    const startsOn = period?.startId || doc.period.startId;
    const endsOn = period?.endId || doc.period.endId;
    const dateEvidence = own?.quote || heading?.dateEvidence || fallbackEvidence;
    if (!dateEvidence) continue;
    const offer = `${bonus[1]}X GTA$${hasRp ? ' & RP' : ''}`;
    const push = (rowOffer, eligibility, rowEvidence) => rows.push({ section: 'bonuses', entity, offer: rowOffer, evidence: rowEvidence,
      dateEvidence, eligibility, platform: 'all', startsOn, endsOn });
    push(offer, memberOnly ? 'gta-plus' : 'all', memberOnly ? evidence : allEvidence);
    if (memberBoost) push(`${memberBoost[1]}X GTA$${hasRp ? ' & RP' : ''}`, 'gta-plus', evidence);
  }
  return rows;
}

// Narrow, cost-free extraction from explicit rotation sections. Unknown formats
// supply no facts; headings, dates and acquisition conditions remain evidence.
export function extractWeeklyRotations(doc) {
  if (!['intel', 'gtabase', 'igta', 'gtaboss', 'reddit'].includes(doc.source.kind) || !doc.period) return { facts: [], rejected: [] };
  const text = stripTags(doc.html);
  const dates = doc.periodEvidence || doc.text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:[-–—]|to|through)\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\d{1,2}(?:st|nd|rd|th)?(?:,?\s+20\d{2})?/i)?.[0];
  if (!dates) return { facts: [], rejected: [] };
  const raw = [];
  const make = (section, entity, offer, evidence) => raw.push({ section, entity: bareName(entity), offer, evidence,
    dateEvidence: dates, eligibility: 'all', platform: 'all', startsOn: doc.period.startId, endsOn: doc.period.endId });
  // A row or the heading above it can name a shorter or later window.
  // The article week is only the fallback for an undated weekly bonus.
  raw.push(...extractDatedBonuses(doc, dates));
  // Both formats explicitly identify the Lucky Wheel prize. A podium vehicle is
  // a chance to win, never a guaranteed free vehicle or a Prize Ride challenge.
  // iGTA has used a colon, an ampersand, and a combined casino heading.
  const podiumBlock = doc.html.match(/<h[1-6][^>]*>\s*(?:Podium Vehicle|Casino Podium and Prize Ride|Diamond Casino Lucky Wheel|The Diamond Casino\s+(?:&(?:amp;)?|and)\s+Resort Lucky Wheel:?)\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i);
  if (podiumBlock) {
    const block = stripTags(podiumBlock[1]);
    const chance = /(?:lucky wheel[\s\S]{0,80}?chance to win the\s+)([A-ZÀ-ž][A-Za-zÀ-ž0-9’' -]+?)(?=,|\s+which\b|\s+from\b)/i.exec(block);
    const listed = /^\s*([A-ZÀ-ž][A-Za-zÀ-ž0-9’' -]+?)\s*\([^)]{1,40}\)/.exec(block);
    const reversed = /chance to win the\s+([A-ZÀ-ž][A-Za-zÀ-ž0-9’' -]+?)\s+from the Lucky Wheel/i.exec(block);
    const described = /podium vehicle[^.]{0,80}? is the (.+?)\s*\([^)]*\)[^.]{0,80}?chance to win[^.]*Lucky Wheel/i.exec(block);
    const entity = bareName(chance?.[1] || listed?.[1] || reversed?.[1] || described?.[1] || '');
    const heading = stripTags(podiumBlock[0].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || '');
    if (entity) make('free-vehicles', entity, 'Podium vehicle: chance to win at the Lucky Wheel; winning is not guaranteed',
      chance ? chance[0] : reversed ? reversed[0] : described ? described[0] : `${heading} ${listed[0].trim()}`);
  }
  const ranked = new RegExp(`place top (\\d+) in (?:a |an |the )?LS Car Meet (?:Race|Series) for ${DAY_WORD} days in a row to (?:unlock|win) (?:the )?${VEHICLE}(?= as | \\(|\\.|$)`, 'i').exec(text)
    || new RegExp(`plac(?:e|ing) in the Top (\\d+) in the LS Car Meet Series for ${DAY_WORD} days in a row (?:will unlock|to (?:unlock|win)) the ${VEHICLE}(?= as | \\(|\\.|$)`, 'i').exec(text)
    || new RegExp(`Finish in the Top (\\d+) of an LS Car Meet Series race for ${DAY_WORD} consecutive days to win the ${VEHICLE}(?= \\(|\\.|$)`, 'i').exec(text);
  if (ranked) {
    const entity = bareName(ranked[3]);
    const verb = /\bwin\b/i.test(ranked[0]) && !/will unlock/i.test(ranked[0]) ? 'win' : 'unlock';
    make('free-vehicles', entity, `Place top ${ranked[1]} in a LS Car Meet Race for ${ranked[2]} days in a row to ${verb} the ${entity}`, ranked[0]);
  }
  const won = !ranked && new RegExp(`win in the LS Car Meet Series for ${DAY_WORD} days in a row to (?:receive|unlock|win) the ${VEHICLE}(?= \\(|\\.|$)`, 'i').exec(text);
  if (won) {
    const entity = bareName(won[2]);
    make('free-vehicles', entity, `Prize Ride: win in the LS Car Meet Series for ${won[1]} days in a row to receive the ${entity}`, won[0]);
  }
  let stockSection = doc.html.match(/<h[1-6][^>]*>\s*Gun Van(?: Contents| Primary Discounts| Inventory(?: and Discounts)?)?\s*<\/h[1-6]>([\s\S]*?)(?=<h[1-6]|$)/i)?.[1];
  if (doc.source.kind === 'gtabase' && stockSection) stockSection = stockSection.split(/<\/ul>/i)[0];
  const stock = (stockSection ? stripTags(stockSection) : null) || /Gun Van (?:Contents|Inventory)([\s\S]*?)(?=Premium Race|Rotating Content|Gun Van exclusive|$)/i.exec(text)?.[1];
  if (stock) for (const entity of ['Sweeper Shotgun', 'Knuckle Dusters', 'Knife', 'Combat Shotgun', 'Precision Rifle', 'Pipe Bombs', 'Railgun', 'Stun Gun', 'Heavy Rifle', 'Grenade Launcher', 'Vintage Pistol', 'Nightstick', 'Baseball Bat', 'The Shocker', 'Service Carbine', 'Widowmaker', 'Up-n-Atomizer', 'Unholy Hellbringer', 'Tactical SMG', 'Battle Rifle', 'Compact EMP Launcher', 'Heavy Sniper', 'Pump Shotgun', 'Pipe Wrench', 'Assault Shotgun', 'Combat MG', 'SMG', 'Micro SMG', 'Carbine Rifle', 'Sniper Rifle', 'Molotovs', 'Grenades', 'Sticky Bombs', 'Tear Gas', 'Proximity Mines', 'Super Light Armor', 'Light Armor', 'Standard Armor', 'Heavy Armor', 'Super Heavy Armor']) {
    const names = entity.replaceAll(' ', '\\s+');
    const match = [...stock.matchAll(new RegExp(`(?<![\\w-])${names}(?![\\w-])`, 'gi'))].find(candidate =>
      !(['SMG', 'Carbine Rifle', 'Sniper Rifle', 'Light Armor', 'Heavy Armor', 'Grenades'].includes(entity) &&
        /(?:Tactical|Micro|Service|Heavy|Super|Sticky)\s*$/i.test(stock.slice(0, candidate.index))));
    if (match) make('gun-van', entity, 'In stock', match[0]);
  }
  const inStock = entity => raw.some(f => f.section === 'gun-van' && f.entity === entity && f.offer === 'In stock');
  const pushGunOffer = (entity, offer, evidence, eligibility) => {
    if (!entity || entity === 'El Strickler' || !inStock(entity) && entity !== 'Armor') return;
    make('gun-van', entity, offer, evidence);
    raw.at(-1).eligibility = eligibility;
  };
  // Only the explicit regular/GTA+ pair supplies two discount facts. Bare stock
  // lists, price tables and unknown platform restrictions cannot establish them.
  if (stockSection && doc.source.kind === 'intel') for (const [, row] of stockSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const evidence = stripTags(row);
    const free = /^([A-Za-z][A-Za-z0-9’' -]+)\s*\(\s*FREE\s*\)$/i.exec(evidence);
    if (free) { pushGunOffer(free[1].trim(), 'FREE', evidence, 'all'); continue; }
    const pair = /^([A-Za-z][A-Za-z0-9’' -]+)\s*\((\d{1,2})%,\s*GTA\+\s*(\d{1,2})%\)$/.exec(evidence);
    if (!pair || pair[1].trim() === 'El Strickler') continue;
    const entity = pair[1].trim();
    if (!inStock(entity) || +pair[2] <= 0 || +pair[3] <= 0) continue;
    pushGunOffer(entity, `${pair[2]}% off at the Gun Van`, `${entity} (${pair[2]}%`, 'all');
    pushGunOffer(entity, `${pair[3]}% off at the Gun Van`, evidence, 'gta-plus');
  }
  if (stockSection && doc.source.kind === 'igta') for (const [, row] of stockSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const evidence = stripTags(row).replace(/\.$/, '');
    const rateFirst = /^(\d{1,2})%\s*off(\s+for\s+GTA\+\s+Members)?\s*[-–—]\s*(.+)$/i.exec(evidence);
    const nameFirst = /^(.+?)\s*[-–—:]\s*(\d{1,2})%\s*off(\s+for\s+GTA\+\s+Members)?$/i.exec(evidence);
    const freeFirst = /^free\s*[-–—]\s*(.+)$/i.exec(evidence);
    const freeLast = /^(.+?)\s*[-–—:]\s*free$/i.exec(evidence);
    if (rateFirst || nameFirst) {
      const percent = (rateFirst || nameFirst)[rateFirst ? 1 : 2];
      const entity = bareName(rateFirst ? rateFirst[3] : nameFirst[1]);
      const members = Boolean(rateFirst ? rateFirst[2] : nameFirst[3]);
      if (+percent <= 0) continue;
      pushGunOffer(entity, `${percent}% off at the Gun Van`, evidence, members ? 'gta-plus' : 'all');
    } else if (freeFirst || freeLast) {
      pushGunOffer(bareName(freeFirst ? freeFirst[1] : freeLast[1]), 'FREE', evidence, 'all');
    }
  }
  if (stockSection && doc.source.kind === 'gtabase') for (const [, row] of stockSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const evidence = stripTags(row);
    const match = /^(Free|\d{1,2}% Off)( GTA\+)?\s*:\s*(.+)$/i.exec(evidence);
    if (!match) continue;
    const offer = /^free/i.test(match[1]) ? 'FREE' : `${parseInt(match[1])}% off at the Gun Van`;
    for (const entity of match[3].split(/\s*&\s*/)) pushGunOffer(entity.trim(), offer, evidence, match[2] ? 'gta-plus' : 'all');
  }
  // Read dated percentage lists directly. Preserve the actual contiguous group
  // as evidence; never prepend a synthetic rate to a source quotation.
  // iGTA puts the rate in the heading or after the vehicle name.
  if (['intel', 'igta'].includes(doc.source.kind)) {
    const article = doc.html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || doc.html;
    const blocks = [...article.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[23]\b|$)/gi)];
    const articleText = stripTags(article);
    for (const [, , headingHtml, body] of blocks) {
      const headingText = stripTags(headingHtml);
      const ownDiscount = /discounts?|\b(?:all\s+)?\d{1,2}%\s*off\b/i.test(headingText);
      if (/gun van|lucky wheel|podium|prize ride|weekly challenge|time trial|premium race/i.test(headingText)) continue;
      if (!ownDiscount) continue;
      const groups = doc.source.kind === 'intel' ? body.split(/(?=<h[4-6]\b)/i) : [body];
      for (const group of groups) {
        const prefix = group.slice(0, group.search(/<(?:ul|ol)\b/i));
        const rate = /\b(\d{1,2})%\s*off\b/i.exec(stripTags(prefix)) || /\b(\d{1,2})%\s*off\b/i.exec(headingText);
        const percentFromHeading = rate?.[1] || null;
        const groupEvidence = stripTags(group);
        for (const [, row] of group.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
          const rowText = stripTags(row).replace(/\.$/, '');
          const rateFirst = /^(\d{1,2})%\s*off\s+(?:[-–—]\s*)?(.+)$/i.exec(rowText);
          const nameFirst = /^(.+?)\s*[-–—:]\s*(\d{1,2})%\s*off$/i.exec(rowText);
          const percent = rateFirst?.[1] || nameFirst?.[2] || percentFromHeading;
          const entity = bareName(rateFirst?.[2] || nameFirst?.[1] || rowText);
          let evidence = rateFirst || nameFirst ? rowText : null;
          if (!evidence && percent) {
            const groupStart = articleText.indexOf(groupEvidence);
            const at = articleText.toLowerCase().indexOf(entity.toLowerCase(), Math.max(0, groupStart));
            const marker = headingText;
            const from = at < 0 ? -1 : articleText.toLowerCase().lastIndexOf(marker.toLowerCase(), at);
            if (from >= 0 && at + entity.length - from <= 650) evidence = articleText.slice(from, at + entity.length);
          }
          if (!percent || +percent <= 0 || !entity || !evidence || evidence.length > 650 || /GTA\+|members|enhanced|PS5|Series X/i.test(evidence)) continue;
          make('discounts', entity, `${percent}% off`, evidence);
        }
      }
    }
  }
  const challenge = /Weekly Challenge(?: for this week is)?(?:[: ]+)"?(Win (?:an?|any) Adversary Mode)"?(?:\. You'll earn| to receive) GTA\$([\d,]+)/i.exec(text);
  if (challenge) make('challenge', 'Adversary Mode', `Win an Adversary Mode to receive GTA$${challenge[2]}`, challenge[0]);
  const priority = /(?:FIB Priority File in GTA Online this week is|featured Priority File is)\s+(The [A-Za-z ]+? File)\b/i.exec(text);
  if (priority) make('other', priority[1], 'Priority File', priority[0]);
  // El Strickler's platform restriction is not established by a bare stock list.
  return validateFacts({ facts: raw }, doc);
}
