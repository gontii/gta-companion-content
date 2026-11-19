import { readBounded, safeFetch } from './http.mjs';
import { addDays, localParts, MINUTE } from './temporal.mjs';
import { currentWeeklyWindow } from './source-service.mjs';
import { rotationSlot } from './section-coverage.mjs';

const platforms = ['ps5', 'xboxsx', 'pcrosalt', 'ps4', 'xboxone', 'pcros'];
const api = 'https://api.rdo.gg/tunables/gta';
const dictionary = 'https://tunables.rdo.gg/data';

async function getJson(url) {
  const response = await safeFetch(url);
  if (!response.ok) throw new Error(`game_settings_http_${response.status}`);
  return JSON.parse(await readBounded(response, 1_000_000));
}

async function readPlatform(platform, week, reset, now, read) {
  const index = await read(`${api}/${platform}/all.json`);
  const latest = index.latest;
  const inEdition = e => e && e.updated * 1000 >= reset && e.updated * 1000 <= now;
  const first = index.all?.find(e => e.date === week && inEdition(e));
  if (!first || !inEdition(latest) || !Number.isSafeInteger(first.weekly_event_id) ||
      first.weekly_event_id !== latest.weekly_event_id || !/^[A-F0-9]{40}$/.test(latest.hash)) {
    throw new Error('game_settings_reset_unconfirmed');
  }
  const url = `${api}/${platform}/${latest.hash}.json`;
  const record = await read(url);
  const values = record.contents?.tunables?.BASE_GLOBALS;
  if (record.hash !== latest.hash || record.updated !== latest.updated || record.date !== latest.date || !values) {
    throw new Error('game_settings_snapshot_mismatch');
  }
  return { platform, values, event: latest.weekly_event_id, source: { kind: 'game-settings', scope: 'weekly', publishedOn: week, url } };
}

function readFacts(records, labels, objectives, startsOn) {
  if (!records.every(r => r.event === records[0].event)) throw new Error('game_settings_event_mismatch');
  const shared = key => {
    const value = records[0].values[key];
    return records.every(r => r.values[key] === value) ? value : undefined;
  };
  const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 100;
  const name = key => typeof labels[key] === 'string' && /^[\p{L}\p{N} &'’.():,-]{2,90}$/u.test(labels[key]) ? labels[key] : null;
  const result = [];
  // All six records must agree. Cite the three current product platforms to
  // leave room for independent sources in the public edition's source limit.
  const sources = records.filter(r => ['ps5', 'xboxsx', 'pcrosalt'].includes(r.platform)).map(r => r.source);
  const add = (section, entity, offer, extra = {}) => result.push({ section, entity, offer, startsOn,
    endsOn: addDays(startsOn, 6), eligibility: 'all', platform: 'all', confidence: 'corroborated',
    sources, ...extra });
  const podium = name(shared('CASINO_PRIZE_VEHICLE_MODEL_HASH'));
  if (podium) add('free-vehicles', podium, 'Podium vehicle: spin the Lucky Wheel at the Diamond Casino & Resort for a chance to win.');
  const prize = name(shared('CAR_MEET_PRIZE_VEHICLE_MODEL_HASH'));
  const series = ['LS Car Meet Series', 'Street Race Series', 'Pursuit Series'][shared('CAR_MEET_PRIZE_VEHICLE_CHALLENGE_ID')];
  const rank = shared('CAR_MEET_PRIZE_VEHICLE_CHALLENGE_PARAM_ONE');
  const days = shared('CAR_MEET_PRIZE_VEHICLE_CHALLENGE_PARAM_TWO');
  if (prize && series && positive(rank) && positive(days) && days <= 7) {
    const placement = rank === 1 ? 'Win a race' : `Place in the top ${rank} in a race`;
    const streak = days === 1 ? '' : ` on ${days} consecutive days`;
    add('free-vehicles', prize, `Prize Ride: ${placement} in the ${series}${streak} to claim the ${prize}.`);
  }
  const id = shared('MP_WEEKLY_OBJECTIVE_ID_OVERRIDE');
  const objective = Number.isSafeInteger(id) && id >= 0 ? objectives[id] : null;
  const count = shared('MP_WEEKLY_OBJECTIVE_COUNT_OVERRIDE');
  const template = objective?.[0] === `AMWO_OBJ_${id}` ? labels[objective[0]] : null;
  if (positive(count) && typeof template === 'string' && template.includes('~1~')) {
    const action = template.replace(/^~a~/, '').replace('~1~', String(count)).trim();
    if (/^[\p{L}\p{N} &'’.():,-]{3,140}$/u.test(action)) {
      const entity = action.replace(/^Complete \d+ /, '');
      add('challenge', entity, action + '.', { targetCount: count, itemId: `weekly-objective-${id}` });
    }
  }
  return result;
}

export async function weeklyRotationFallback(storage, approved, now, read = getJson) {
  const reset = Date.parse(currentWeeklyWindow(now).startsAt);
  const week = localParts(reset).date;
  const present = new Set(approved.filter(f => f.startsOn === week && f.endsOn === addDays(week, 6)).map(f => rotationSlot(f)).filter(Boolean));
  if (present.size === 3) return [];
  let saved = await storage.get('game-settings-weekly');
  if (saved?.week !== week || now >= saved.retryAt) {
    const records = await Promise.all(platforms.map(p => readPlatform(p, week, reset, now, read)));
    const [labels, objectives] = await Promise.all([read(dictionary + '/labels.json'), read(dictionary + '/weekly_objectives.json')]);
    const facts = readFacts(records, labels, objectives, week);
    saved = { week, facts, retryAt: now + (facts.length === 3 ? 60 : 15) * MINUTE };
    await storage.put('game-settings-weekly', saved);
  }
  return saved.facts.filter(f => !present.has(rotationSlot(f)));
}
