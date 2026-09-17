import { activeAt } from './temporal.mjs';

// Stałe wejścia do aktywności. Oferty, wymagania i terminy pochodzą z bieżących
// pozycji wydania; katalog nie ustala dziennych rotacji ani współrzędnych.
const routes = [
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
      startsAt: item.startsAt, expiresAt: item.expiresAt,
      originalZone: item.originalZone, precision: item.precision, timingConfidence: item.timingConfidence });
  }
  result.locations = [...manual, ...generated];
  return result;
}
