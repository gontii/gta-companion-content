import { activeAt } from './temporal.mjs';

// Stałe wejścia do aktywności. Oferty, wymagania i terminy pochodzą z bieżących
// pozycji wydania; katalog nie ustala dziennych rotacji ani współrzędnych.
const routes = [
  { id: 'halloween-survivals', match: /halloween survivals|ludendorff cemetery survival/i, activity: 'Halloween Survivals', name: 'Survival job selection', area: 'Pause Menu → Online → Jobs → Play Job → Rockstar Created → Survivals', note: 'Select the Halloween Survival named in the current offer. Ludendorff Cemetery is entered through a job or its Survival map blip; do not try to drive to North Yankton in Freemode. Availability follows the current playlist.', sourceUrl: 'https://www.rockstargames.com/newswire/article/3999181oaa34ko/fight-off-the-north-yankton-nightmare-in-the-new-ludendorff-cemetery-s' },
  { id: 'ghosts-exposed', match: /ghosts exposed/i, activity: 'Ghosts Exposed', name: 'Freemode ghost photography', area: 'Southern San Andreas → follow the Ghosts Exposed text and current event clues', note: 'Use your phone’s Snapmatic camera to photograph the ghosts and check progress in the Interaction Menu. This is a Freemode search, not a mission started at a property. This guide has not verified this year’s individual ghost coordinates or spawn hours.', sourceUrl: 'https://www.rockstargames.com/newswire/article/3999181oaa34ko/fight-off-the-north-yankton-nightmare-in-the-new-ludendorff-cemetery-s' },
  { id: 'dispatch-work', match: /dispatch work/i, activity: 'Dispatch Work', name: 'Vincent’s Dispatch Work', area: 'Freemode → your owned Law Enforcement personal vehicle', note: 'First complete Slush Fund from The Cluckin’ Bell Farm Raid as leader. While driving your Law Enforcement vehicle, request Dispatch Work with the displayed prompt (R3/RS on console, B on PC). Follow Vincent’s assigned mission markers; there is no single fixed destination.', sourceUrl: 'https://www.rockstargames.com/newswire/article/o3948k534952a8/protect-los-santos-and-acquire-new-law-enforcement-vehicles-during-the' },
  { id: 'bail-office', match: /bail office/i, activity: 'Bail Office Targets & Challenge', name: 'Your Bail Office', area: 'Your owned Bail Office → bounty selection', note: 'Start the bounty from your Bail Office and follow the assigned target markers. Standard and Most Wanted targets have different availability; check the current target selection and the exact weekly challenge below. Dispatch Work is a separate activity and does not substitute for securing a Bail Office bounty.', sourceUrl: 'https://www.rockstargames.com/newswire/article/51195a98k31273/gta-online-bottom-dollar-bounties-out-now' },
  { id: 'community-series', match: /community (?:race )?series/i, activity: 'Community Series', name: 'Community Series matchmaking', area: 'Legion Square → series marker, or phone → Quick Join', note: 'Use the Community Series marker or your phone’s Quick Join selection. Select the current Community Race Series when the offer names races; other community-created jobs do not automatically qualify for that bonus.', sourceUrl: 'https://www.rockstargames.com/newswire/article/39985174okk573/bag-3x-gta-and-rp-on-drift-and-drag-races-ahead-of-next-week-s-big-gta' },
  { id: 'bunker-research', match: /bunker research/i, activity: 'Bunker Research & Weekly Challenge', name: 'Call Agent 14', area: 'Your phone → Contacts → Agent 14', note: 'Own and set up a Bunker, then call Agent 14 and request Bunker Research. Follow the mission marker and return the research to your Bunker. For a challenge requiring these missions, buying supplies or paying to fast-track research is not a substitute.' },
  { id: 'ammu-nation', match: /ammu.nation contract/i, activity: 'Ammu-Nation Contract', name: 'Duneloader inside your Bunker', area: 'Your owned Bunker → entrance', note: 'Enter your Bunker and look for the loaded Duneloader marked with a blue blip near the entrance. Get in to start the surplus-weapons delivery, then follow the route to the assigned Ammu-Nation. If no load is ready, return later.' },
  { id: 'grapeseed-bunker', match: /grapeseed bunker/i, activity: 'Free Property', name: 'Grapeseed Bunker', area: 'Grapeseed, Blaine County', note: 'Open the in-game phone → Internet → Maze Bank Foreclosures, select the Grapeseed Bunker and check the displayed price before confirming. The offer is for this property; optional upgrades are separate. If you already own a Bunker, check the trade-in consequences before replacing it.' },
  { id: 'prize-ride', match: /prize ride|ls car meet race/i, activity: 'Prize Ride', name: 'Los Santos Car Meet', area: 'Cypress Flats → LS Car Meet map icon', note: 'Enter the Car Meet and check Prize Ride Challenge in the Interaction Menu. Join the required LS Car Meet race series and check your progress after each result. Consecutive-day requirements need separate qualifying days; collect the reward from the Prize Ride menu after completion.' },
  { id: 'podium', match: /casino podium|podium vehicle|lucky wheel/i, activity: 'Casino Podium', name: 'The Diamond Casino & Resort', area: 'East Vinewood → Casino map icon', note: 'Enter the casino and use the Lucky Wheel in the main lobby. The podium car is a chance reward, not a guaranteed free claim. Check the wheel for your next available spin; availability can depend on your region.' },
  { id: 'gun-van', section: 'gun-van', activity: 'Gun Van', name: 'Mobile weapons dealer', area: 'Daily rotating stop in Southern San Andreas', note: 'The stock below belongs to this week; the parking spot changes daily. Today’s exact stop is not verified in this guide. Without GTA+, the van icon appears when you are nearby; GTA+ members can locate it on the map. Approach the open rear doors to browse weapons and compare the price shown for your membership.' },
  { id: 'business-battles', match: /business battle/i, activity: 'Business Battle Rewards', name: 'Freemode event cargo', area: 'Session-dependent event marker', note: 'Wait for a Business Battle in Freemode, then use the event’s cargo marker and delivery destination. Pick up and deliver the crates; the route is assigned by the event, not one permanent address. Check the current reward description below.' },
  { id: 'la-coureuse', match: /la coureuse/i, activity: 'La Coureuse Reward', name: 'Legendary Motorsport', area: 'In-game phone → Internet → Legendary Motorsport', note: 'First satisfy the qualification shown below. The car is claimed through the in-game website during its separate claim window, not by visiting a street showroom. Do not buy it early expecting the later free claim to apply. Check platform eligibility for the HSW upgrade.' },
  { id: 'astron', match: /astron custom/i, activity: 'Vehicle Discount', name: 'Legendary Motorsport', area: 'In-game phone → Internet → Legendary Motorsport', note: 'Find the exact model named below and check its current price before buying. Astron Custom is the Enhanced-platform model; do not confuse it with the standard Astron. A discount does not make the car free.' },
];

export function rebuildWeeklyLocations(content, now = Date.now()) {
  const live = content.sections.flatMap(s => s.items.map(item => ({ ...item, sectionId: s.id })))
    .filter(item => activeAt(item, now));
  const result = structuredClone(content);
  // Zachowaj odrębne notatki redakcyjne; nasze pozycje odtwarzaj z bieżących danych.
  const manual = (result.locations || []).filter(l => !l.id.startsWith('auto-location-') && activeAt(l, now));
  const generated = [];
  for (const route of routes) {
    const matches = live.filter(item => route.section ? item.sectionId === route.section : route.match.test(item.label));
    if (!matches.length) continue;
    // Wyzwanie ma pierwszeństwo przed premią za tę samą aktywność.
    const item = matches.find(i => i.sectionId === 'challenge') || matches[0];
    if (manual.some(l => l.itemIds?.includes(item.id))) continue;
    const detail = route.section === 'gun-van' ? 'See This Week → Gun Van for the current stock and discounts.' : `This week: ${item.label}`;
    generated.push({ id: `auto-location-${route.id}`, activity: route.activity, name: route.name,
      area: route.area, note: `${route.note}\n\n${detail}`, itemIds: [item.id],
      ...(route.sourceUrl?{sources:[{kind:'rockstar',url:route.sourceUrl}]}:{}),
      startsAt: item.startsAt, expiresAt: item.expiresAt,
      originalZone: item.originalZone, precision: item.precision, timingConfidence: item.timingConfidence });
  }
  result.locations = [...manual, ...generated];
  return result;
}

// Mierzymy wskazówki odnoszące się do konkretnych aktywnych ID, nie samą liczbę kart.
export function weeklyLocationCoverage(content,now=Date.now()) {
  const live=content.sections.flatMap(s=>s.items.map(i=>({...i,sectionId:s.id}))).filter(i=>activeAt(i,now));
  const recognized=new Set(live.filter(i=>routes.some(r=>r.section?i.sectionId===r.section:r.match.test(i.label))).map(i=>i.id));
  const covered=new Set((content.locations||[]).filter(l=>activeAt(l,now)).flatMap(l=>l.itemIds||[]));
  const recognizedRoutes=routes.filter(r=>live.some(i=>r.section?i.sectionId===r.section:r.match.test(i.label)));
  const coveredRoutes=recognizedRoutes.filter(r=>(content.locations||[]).some(l=>activeAt(l,now)&&
    (l.id===`auto-location-${r.id}`||live.some(i=>(r.section?i.sectionId===r.section:r.match.test(i.label))&&l.itemIds?.includes(i.id)))));
  return {liveItems:live.length,recognizedItems:recognized.size,coveredItems:live.filter(i=>covered.has(i.id)).length,
    recognizedRoutes:recognizedRoutes.length,coveredRoutes:coveredRoutes.length,uncoveredRouteIds:recognizedRoutes.filter(r=>!coveredRoutes.includes(r)).map(r=>r.id),
    recognizedUncoveredIds:[...recognized].filter(id=>!covered.has(id)),
    unrecognizedIds:live.filter(i=>!recognized.has(i.id)).map(i=>i.id)};
}
