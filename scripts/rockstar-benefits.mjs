import { safeFetch, readBounded } from './http.mjs';
import { stripTags } from './weekly-core.mjs';
import { addDays, localParts } from './temporal.mjs';

const META = 'query MetaUrlInfo($url:String,$locale:String!,$cache:Boolean=true){metaUrlInfo(url:$url,locale:$locale,cache:$cache){url title description id tina{payload variables{keys}}}}';
const MODULES = 'query TinaModulesInfo($ids:[String]!,$locale:String!,$cache:Boolean=false){tinaModulesInfo(ids:$ids,locale:$locale,cache:$cache){id:id_hash title type visible tina{payload variables{keys}}}}';
const URL = 'https://www.rockstargames.com/gta-plus/benefits';
function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) visit(value);
  for (const child of Object.values(value)) if (typeof child === 'object') walk(child, visit);
}
function localized(node, module) { return { ...node._memoq, ...module.tina?.variables?.keys?.[node.key] }; }
async function graph(operationName, query, variables, fetchImpl) {
  const url = new globalThis.URL('https://graph.rockstargames.com/');
  url.search = new URLSearchParams({origin:'https://www.rockstargames.com',operationName,query,variables:JSON.stringify({...variables,locale:'en-US',cache:false})});
  const response = await fetchImpl(url);
  if (!response.ok) throw Error(`benefits_http_${response.status}`);
  const data = JSON.parse(await readBounded(response));
  if (data.errors?.length || !data.data) throw Error('benefits_graphql_invalid');
  return data.data;
}
const uniqueIds = ids => [...new Set(ids.filter(id=>typeof id==='string' && /^[a-z0-9]{5,12}$/.test(id)))].slice(0,80);
export function benefitLinks(module, template) {
  const ids=[];
  walk(module.tina?.payload?.content, n=>{
    if(n._template===template) {
      if(template==='Deck') ids.push(...(n.cards || []).map(c=>c.id));
      else ids.push(n.id);
    }
  });
  return uniqueIds(ids);
}
export function benefitEnd(meta) {
  let end;
  walk(meta.tina?.payload?.content,n=>{
    if(n._template==='gen9.ClaimCountdown') {
      const value=localized(n,meta);
      if(value.left==='Claim these event benefits through' && /^[A-Za-z]+ \d{1,2}, 20\d{2}$/.test(value.right || '')) {
        const at=Date.parse(value.right+' UTC');
        if(Number.isFinite(at)) end=new Date(at).toISOString().slice(0,10);
      }
    }
  });
  if(!end) throw Error('benefits_end_date_missing');
  return end;
}
export function calendarPeriod(raw, end, today, sourceUrl) {
  const line = raw.match(/^\|availability\s*=\s*(.+)$/m)?.[1]?.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g,'$1');
  const m=line?.match(/^([A-Za-z]+ \d{1,2}, 20\d{2})\s*[-–—]\s*([A-Za-z]+ \d{1,2}, 20\d{2})$/);
  if(!m) throw Error('benefits_calendar_missing');
  const dates=m.slice(1).map(s=>new Date(Date.parse(s+' UTC')).toISOString().slice(0,10));
  if(dates[1]!==end || dates[0]>today || today>end || Date.parse(end)-Date.parse(dates[0])>62*86400000) throw Error('benefits_calendar_mismatch');
  return {startId:dates[0],endId:end,sourceUrl,evidence:line};
}
export function parseBenefitCards(modules, period) {
  const facts=[],rejected=[];
  const cycle=Math.max(0,...modules.map(m=>Number(m.title?.match(/^GTA\+(\d+):/)?.[1]) || 0));
  for(const module of modules) {
    if(module.visible===false) continue;
    for(const card of module.tina?.payload?.content || []) {
      if(!['Card','CardWithImageGallery'].includes(card._template)) continue;
      const title=localized(card,module).title?.trim();
      if(!title) continue;
      const tag=localized(card.textOverlayProps || {},module).tag || '';
      const paragraphs=[];
      walk(card.content,n=>{if(['HTMLElement','gen9.Disclaimer'].includes(n._template)){const v=localized(n,module); paragraphs.push(stripTags(v.content || v.text || ''));}});
      const text=paragraphs.join(' '), pricing=localized(card.pricingOptions || {},module);
      let entity=title,offer;
      const multiplier=/^(\d+)X GTA\$ and RP on (.+)$/i.exec(title);
      const speed=/^(\d+)X Speed on (.+)$/i.exec(title);
      if(multiplier) {entity=multiplier[2];offer=`${multiplier[1]}X GTA$ & RP`;}
      else if(speed && /Staff Sourced Special Cargo/.test(title)) {entity=speed[2];offer=`${speed[1]}X sourcing speed for Warehouse staff.`;}
      else if(/Warehouses and Vehicle Warehouses Discount/.test(title) && /Warehouses and Vehicle Warehouses are (\d+)% off/.test(text)) {
        entity='Warehouses and Vehicle Warehouses';offer=`${text.match(/are (\d+)% off/)[1]}% off; purchase via the SecuroServ computer in your Executive Office.`;
      } else if(/^(\d+)% Discount on Body Armor and Ammo$/.test(title) && /including Mk II Ammo/.test(text)) {
        entity='Body Armor and Ammo';offer=`${title.match(/^\d+/)[0]}% off, including Mk II Ammo; Ammu-Nation and Gun Van. Stacks with existing Gun Van markdowns.`;
      } else if(/Vehicle Benefits/.test(tag) && /free to claim/i.test(text) && /Vinewood Car Club/.test(text)) offer='FREE; claim at The Vinewood Car Club.';
      else if(/Vehicle Benefits/.test(tag) && /both free|marked FREE/i.test(text) && /Chameleon/.test(title)) offer='FREE; select the Chameleon paints at an Auto Shop or Vehicle Workshop with an eligible vehicle.';
      else if(tag==='Free Clothing' && /added automatically.*wardrobes/i.test(text)) offer='FREE; automatically added to your wardrobe.';
      else if(tag==='Free Painting' && /added automatically.*Decorations/i.test(text)) offer='FREE; automatically added to Mansion Decorations.';
      else if(tag==='Free Weapon Finishes' && /Gun Van/.test(text) && /for free/.test(text)) offer='FREE weapon finishes; claim at the Gun Van.';
      else if(/^\d+% OFF$/.test(pricing.tag || '')) offer=`${parseInt(pricing.tag)}% off at The Vinewood Car Club.`;
      else if(pricing.tag==='FREE' && pricing.discountPrice==='GTA$0') offer='FREE; claim at The Vinewood Car Club.';
      if(!offer) {
        // Persistent amenities and the games library are not the rotating event.
        // A new monthly card, however, must make incomplete parsing visible.
        if(module.title?.startsWith(`GTA+${cycle}:`)) rejected.push({entity:title,reason:'benefits_card_format_unrecognized'});
        continue;
      }
      const base={section:'gta-plus',entity,offer,eligibility:'gta-plus',platform:'enhanced',startsOn:period.startId,endsOn:period.endId,
        sources:[{kind:'rockstar',scope:'membership',url:`${URL}?info=${module.id}`},{kind:'editorial',scope:'membership',url:period.sourceUrl}],
        evidence:[title,tag,text].join(' '),dateEvidence:period.evidence};
      const boost=/stacks to (\d+)X between ([A-Za-z]+ \d{1,2}) and ([A-Za-z]+ \d{1,2})/.exec(text);
      if(boost && multiplier) {
        const year=period.startId.slice(0,4);
        const start=new Date(Date.parse(boost[2]+', '+year+' UTC')).toISOString().slice(0,10);
        const end=new Date(Date.parse(boost[3]+', '+year+' UTC')).toISOString().slice(0,10);
        if(start<period.startId || end>period.endId || end<start) {rejected.push({entity:title,reason:'benefits_boost_window_invalid'});continue;}
        if(start>period.startId) facts.push({...base,endsOn:addDays(start,-1)});
        facts.push({...base,startsOn:start,endsOn:end,offer:`${boost[1]}X GTA$ & RP`});
        if(end<period.endId) facts.push({...base,startsOn:addDays(end,1)});
      } else facts.push(base);
    }
  }
  return {facts:[...new Map(facts.map(f=>[`${f.entity}:${f.startsOn}`,f])).values()],rejected,
    coverageGaps:rejected.length ? ['gta-plus'] : []};
}
export async function resolveRockstarBenefits(storage, now=Date.now(), fetchImpl=safeFetch) {
  const meta=(await graph('MetaUrlInfo',META,{url:'/gta-plus/benefits'},fetchImpl)).metaUrlInfo;
  const endsOn=benefitEnd(meta),today=localParts(now).date;
  if(endsOn<today) throw Error('benefits_page_expired');
  let period=await storage.get('benefits-calendar:'+endsOn);
  if(!period) {
    for(const delta of [0,-1]) {
      const date=new Date(now);date.setUTCMonth(date.getUTCMonth()+delta,1);
      const month=new Intl.DateTimeFormat('en-US',{month:'long',timeZone:'UTC'}).format(date);
      const sourceUrl=`https://gta.wiki/w/GTA%2B_${month}_${date.getUTCFullYear()}`;
      try {
        const response=await fetchImpl(sourceUrl+'?action=raw');
        if(!response.ok) {await response.body?.cancel();continue;}
        period=calendarPeriod(await readBounded(response,150000),endsOn,today,sourceUrl);break;
      } catch { /* A different month cannot supply the missing start date. */ }
    }
    if(!period) throw Error('benefits_start_date_unconfirmed');
    await storage.put('benefits-calendar:'+endsOn,period);
  }
  const ids=benefitLinks(meta,'TinaModuleFetchNRender');
  if(!ids.length) throw Error('benefits_modules_missing');
  const modules=(await graph('TinaModulesInfo',MODULES,{ids},fetchImpl)).tinaModulesInfo;
  const cards=uniqueIds(modules.flatMap(m=>benefitLinks(m,'Deck')));
  if(!cards.length) throw Error('benefits_cards_missing');
  const details=(await graph('TinaModulesInfo',MODULES,{ids:cards},fetchImpl)).tinaModulesInfo;
  const parsed=parseBenefitCards(details,period);
  if(!parsed.facts.length) throw Error('benefits_facts_missing');
  return {source:{kind:'rockstar',scope:'membership',url:URL},period,current:true,publishedOn:null,text:'',...parsed};
}
