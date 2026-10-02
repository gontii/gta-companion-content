import {readFile} from 'node:fs/promises';
import {rebuildWeeklyLocations,weeklyLocationCoverage} from './weekly-locations.mjs';
const [filename,at]=process.argv.slice(2);
if(!filename)throw Error('Podaj plik tygodnia i opcjonalny czas ISO');
const now=at===undefined?Date.now():Date.parse(at);
if(!Number.isFinite(now))throw Error('Nieprawidłowy czas');
const content=JSON.parse(await readFile(filename,'utf8'));
console.log(JSON.stringify({weekId:content.weekId,at:new Date(now).toISOString(),before:weeklyLocationCoverage(content,now),prepared:weeklyLocationCoverage(rebuildWeeklyLocations(content,now),now)},null,2));
