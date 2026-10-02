import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildWeeklyLocations,weeklyLocationCoverage } from '../scripts/weekly-locations.mjs';
import { projectContent } from '../scripts/temporal.mjs';
const now=Date.parse('2026-09-17T10:00:00Z');
const item=(id,label,ends='2026-09-24T09:00:00Z')=>({id,label,startsAt:'2026-09-17T09:00:00Z',expiresAt:ends});
const content=()=>({schemaVersion:2,weekId:'2026-09-17',headline:'Test',startsAt:'2026-09-17T09:00:00Z',expiresAt:'2026-09-24T09:00:00Z',quickTake:[],beginnerPath:[],locations:[],sections:[
{id:'bonuses',items:[item('research','Bunker Research — 2X rewards')]},
{id:'challenge',items:[item('challenge','Complete 3 Bunker Research Missions for GTA$1M')]},
{id:'free-vehicles',items:[item('prize','Prize Ride: win four days in a row'),item('bunker','Grapeseed Bunker — free')]},
{id:'gun-van',items:[item('stun','Stun Gun — 40% off'),item('smg','Tactical SMG')]}
]});
test('odtwarza użyteczne lokalizacje przy pustym nowym tygodniu, grupuje Gun Van i research',()=>{
 const c=rebuildWeeklyLocations(content(),now);assert.equal(c.locations.length,4);
 const research=c.locations.find(l=>l.id==='auto-location-bunker-research');
 assert.deepEqual(research.itemIds,['challenge']);assert.match(research.note,/Contacts|call Agent 14/i);assert.match(research.note,/3 Bunker Research/);
 assert.match(c.locations.find(l=>l.id==='auto-location-prize-ride').note,/four days/);
 const van=c.locations.find(l=>l.id==='auto-location-gun-van');assert.match(van.note,/exact stop is not verified/);assert.doesNotMatch(van.area,/Grapeseed|Cypress/);
 assert.deepEqual(rebuildWeeklyLocations(c,now),c);
});
test('nowe aktywności mają wejścia i źródła, raport ujawnia nieznane oraz rozpoznane bez wskazówki',()=>{
 const c=content();c.sections=[{id:'bonuses',items:[item('survival','Halloween Survivals — 3X'),item('ghost','Ghosts Exposed — 2X'),item('dispatch','Dispatch Work'),item('bail','Standard Bail Office Targets'),item('community','Community Race Series'),item('unknown','Unknown activity')]},{id:'challenge',items:[item('bail-challenge','Secure two Bail Office Bounties')]}];
 const out=rebuildWeeklyLocations(c,now);assert.equal(out.locations.length,5);
 assert.ok(out.locations.every(l=>l.sources[0].url.startsWith('https://www.rockstargames.com/')));
 assert.match(out.locations.find(l=>l.id==='auto-location-ghosts-exposed').note,/not verified/);
 assert.match(out.locations.find(l=>l.id==='auto-location-dispatch-work').note,/Slush Fund|R3\/RS/);
 assert.deepEqual(weeklyLocationCoverage(out,now),{liveItems:7,recognizedItems:6,coveredItems:5,recognizedRoutes:5,coveredRoutes:5,uncoveredRouteIds:[],recognizedUncoveredIds:['bail'],unrecognizedIds:['unknown']});
 assert.deepEqual(out.sections,c.sections);assert.deepEqual(rebuildWeeklyLocations(out,now),out);
 assert.equal(weeklyLocationCoverage(out,Date.parse('2026-09-24T09:00:00Z')).liveItems,0);
});
test('usunięta lub wygasła aktywność usuwa wskazówki i nie przechodzi do następnego tygodnia',()=>{
 const c=rebuildWeeklyLocations(content(),now);c.sections.find(s=>s.id==='gun-van').items=[];
 assert.ok(!rebuildWeeklyLocations(c,now).locations.some(l=>l.id==='auto-location-gun-van'));
 assert.equal(projectContent(c,Date.parse('2026-09-24T09:00:00Z')).locations.length,0);
 assert.equal(rebuildWeeklyLocations(c,Date.parse('2026-09-24T09:00:00Z')).locations.length,0);
});
test('nie wymyśla miejsc dla nieznanych aktywności i zachowuje szczegółową notatkę redakcyjną',()=>{
 const c=content();c.locations=[{id:'custom',name:'Reviewed spot',area:'Reviewed area',activity:'Research',itemIds:['challenge']}];
 const out=rebuildWeeklyLocations(c,now);assert.equal(out.locations[0].id,'custom');assert.ok(!out.locations.some(l=>l.id==='auto-location-bunker-research'));
 assert.equal(rebuildWeeklyLocations({...c,locations:[],sections:[{id:'bonuses',items:[item('unknown','Unknown activity')]}]},now).locations.length,0);
});
