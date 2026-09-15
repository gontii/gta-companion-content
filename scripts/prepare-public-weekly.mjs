import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePublicWeekly, PUBLIC_WEEKLY_KEY } from '../schemas/public-weekly.mjs';
import {validateContent,extractDateRange} from './weekly-core.mjs';
import {validateSnapshot} from './facts.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function preparePublicWeekly(publicText, {appText, review, now = Date.now()} = {}) {
  const doc = validatePublicWeekly(JSON.parse(publicText), now);
  if (doc.status === 'active') {
    if (!appText || !review) throw new Error('Aktywne wydanie wymaga dokumentu aplikacji i odbioru wspólnych faktów');
    const app = JSON.parse(appText);
    if (app.schemaVersion === 2) validateSnapshot(app, {published:true}); else validateContent(app);
    if (app.weekId !== doc.weekId) throw new Error('Różne tygodnie strony i aplikacji');
    const iso = /^(\d{4}-\d{2}-\d{2})\s+[–-]\s+(\d{4}-\d{2}-\d{2})$/.exec(app.range || '');
    const period = iso ? {startId:iso[1],endId:iso[2]} : extractDateRange(app.range || '', {publishedWeekId:app.weekId,now:new Date(app.weekId)});
    if (period?.startId !== doc.startsOn || period?.endId !== doc.endsOn) throw new Error('Różne okresy strony i aplikacji');
    if (review.publicSha256 !== hash(publicText) || review.appSha256 !== hash(appText)) throw new Error('Zmiana dokumentu po odbiorze');
    if (review.status !== 'zatwierdzone' || !Number.isFinite(Date.parse(review.reviewedAt)) ||
      Date.parse(review.reviewedAt) < Date.parse(doc.confirmedAt) || Date.parse(review.reviewedAt) > now) throw new Error('Niepoprawny odbiór redakcyjny');
    const expected = doc.sections.flatMap(s=>s.items).filter(i=>i.status==='confirmed').map(i=>i.id).sort();
    if (JSON.stringify([...(review.checkedFactIds || [])].sort()) !== JSON.stringify(expected)) throw new Error('Niepełny odbiór wspólnych faktów');
  }
  return [{key:PUBLIC_WEEKLY_KEY,value:JSON.stringify(doc)}];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file,...args]=process.argv.slice(2);
  if (!file) throw new Error('Podaj weekly/public/YYWW.json [--output plik] [--app plik --review plik]');
  const options={};
  for (let i=0;i<args.length;i+=2) {
    if (!['--output','--app','--review'].includes(args[i]) || !args[i+1]) throw new Error('Niepoprawne argumenty');
    options[args[i].slice(2)]=args[i+1];
  }
  const publicText=readFileSync(file,'utf8');
  const bulk=preparePublicWeekly(publicText,{appText:options.app&&readFileSync(options.app,'utf8'),review:options.review&&JSON.parse(readFileSync(options.review,'utf8'))});
  if (options.output) {
    if ([file,options.app,options.review].filter(Boolean).some(p=>resolve(p)===resolve(options.output))) throw new Error('Nie nadpisuj źródeł');
    writeFileSync(options.output,JSON.stringify(bulk,null,2)+'\n',{flag:'wx'});
  }
  console.log('Zwalidowane '+JSON.parse(publicText).issue+'; SHA-256 '+hash(publicText)+'; klucz '+PUBLIC_WEEKLY_KEY+'. Bez publikacji.');
}
