// Tworzy wyłącznie pusty szkic. Żadne oferty nie przechodzą z poprzedniego tygodnia.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {issueNumber,date,PLATFORMS,SECTIONS} from '../schemas/public-weekly.mjs';
export function newPublicWeekly(startsOn) {
  const start=date(startsOn);
  return {schemaVersion:1,issue:issueNumber(startsOn),weekId:startsOn,startsOn,
    endsOn:new Date(start+6*86400000).toISOString().slice(0,10),status:'preview',verifiedAt:null,confirmedAt:null,
    platforms:[...PLATFORMS],sections:Object.entries(SECTIONS).map(([id,name])=>({id,items:[{
      id:id+'-pending',name,status:'pending',offer:null,requirements:null,startsOn:null,endsOn:null,claim:null,gtaPlus:id==='gta-plus',sourceIds:[]
    }]})),sources:[]};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const doc=newPublicWeekly(process.argv[2]);
  const target=process.argv[3]||'weekly/public/'+doc.issue+'.json';
  writeFileSync(target,JSON.stringify(doc,null,2)+'\n',{flag:'wx'});
  console.log('Utworzono '+target+'. Uzupełnij źródła, fakty i rzeczywisty verifiedAt przed walidacją. Bez publikacji.');
}
