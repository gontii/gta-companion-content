// Publiczny kontrakt: wyłącznie fakty redakcyjne, bez dokumentu aplikacji.
export const PUBLIC_WEEKLY_KEY = 'weekly:public';
export const MAX_PUBLIC_BYTES = 96 * 1024;
export const PLATFORMS = ['PC Enhanced', 'PS5', 'Xbox Series X|S'];
export const SECTIONS = {
  bonuses: 'Bonuses', rewards: 'Rewards and requirements', discounts: 'Discounts',
  events: 'Ongoing events', 'gta-plus': 'GTA+ member benefits', rotations: 'Weekly rotations',
};
const fail = (message) => { throw new Error(message); };
const requireValue = (condition, message) => { if (!condition) fail(message); };
const object = (value, keys) => {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Wymagany obiekt');
  requireValue(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'Nieznane lub brakujące pola publiczne');
};
const text = (value, max = 700) => requireValue(typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max &&
  !/[<>\u0000-\u001f]/.test(value), 'Niepoprawny tekst');
const id = value => requireValue(typeof value === 'string' && /^[a-z][a-z0-9-]{0,89}$/.test(value), 'Niepoprawny identyfikator');
export function date(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Niepoprawna data');
  const ms = Date.parse(value + 'T00:00:00Z');
  requireValue(Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value, 'Nieistniejąca data');
  return ms;
}
function timestamp(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Niepoprawny czas UTC');
  return Date.parse(value);
}
export function issueNumber(startsOn) {
  const day = new Date(date(startsOn));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const week = Math.ceil(((day - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return String(year % 100).padStart(2, '0') + String(week).padStart(2, '0');
}
export function validatePublicWeekly(doc, now = Date.now()) {
  requireValue(Number.isFinite(now), 'Niepoprawny czas weryfikacji');
  requireValue(new TextEncoder().encode(JSON.stringify(doc)).length <= MAX_PUBLIC_BYTES, 'Dokument za duży');
  object(doc, ['schemaVersion', 'issue', 'weekId', 'startsOn', 'endsOn', 'status', 'verifiedAt', 'confirmedAt', 'platforms', 'sections', 'sources']);
  requireValue(doc.schemaVersion === 1, 'Nieobsługiwana wersja');
  requireValue(doc.issue === issueNumber(doc.startsOn) && doc.weekId === doc.startsOn, 'Niepoprawny numer wydania lub weekId');
  requireValue(date(doc.endsOn) >= date(doc.startsOn), 'Odwrócony okres');
  requireValue(date(doc.endsOn) - date(doc.startsOn) <= 31 * 86400000, 'Zbyt długi okres wydania');
  requireValue(['preview', 'active'].includes(doc.status), 'Niepoprawny stan redakcyjny');
  requireValue(timestamp(doc.verifiedAt) <= now, 'Weryfikacja nie może pochodzić z przyszłości');
  if (doc.status === 'active') {
    requireValue(timestamp(doc.confirmedAt) >= date(doc.startsOn) && timestamp(doc.confirmedAt) <= timestamp(doc.verifiedAt),
      'Aktywne wydanie wymaga potwierdzenia po rozpoczęciu okresu');
  } else requireValue(doc.confirmedAt === null, 'Zapowiedź nie może udawać potwierdzenia aktywności');
  requireValue(JSON.stringify(doc.platforms) === JSON.stringify(PLATFORMS), 'Niepoprawny zakres platform');
  requireValue(Array.isArray(doc.sources) && doc.sources.length > 0 && doc.sources.length <= 30, 'Brak źródeł');
  const sourceIds = new Set();
  for (const s of doc.sources) {
    object(s, ['id', 'title', 'url', 'verifiedAt']);
    id(s.id); text(s.title, 200);
    requireValue(!sourceIds.has(s.id), 'Powtórzone źródło'); sourceIds.add(s.id);
    const url = new URL(s.url);
    requireValue(url.protocol === 'https:' && !url.username && !url.password && s.url.length <= 1500, 'Niepoprawny adres źródła');
    requireValue(timestamp(s.verifiedAt) <= timestamp(doc.verifiedAt), 'Źródło nowsze od wydania');
  }
  requireValue(Array.isArray(doc.sections) && doc.sections.length === Object.keys(SECTIONS).length, 'Brak sekcji');
  const allIds = new Set(['article', 'sources', 'cta-title', ...doc.sources.map(s => 'source-' + s.id)]);
  for (const section of doc.sections) {
    object(section, ['id', 'items']);
    requireValue(Object.hasOwn(SECTIONS, section.id) && !allIds.has(section.id), 'Niepoprawna sekcja');
    allIds.add(section.id);
  }
  let known = 0;
  for (const section of doc.sections) {
    requireValue(Array.isArray(section.items) && section.items.length > 0 && section.items.length <= 100, 'Pusta lub zbyt duża sekcja');
    for (const item of section.items) {
      object(item, ['id', 'name', 'status', 'offer', 'requirements', 'startsOn', 'endsOn', 'claim', 'gtaPlus', 'sourceIds']);
      id(item.id); requireValue(!allIds.has(item.id), 'Powtórzony identyfikator'); allIds.add(item.id);
      text(item.name, 150);
      requireValue(typeof item.gtaPlus === 'boolean' && item.gtaPlus === (section.id === 'gta-plus'), 'Błędne oznaczenie GTA+');
      requireValue(['confirmed', 'pending'].includes(item.status), 'Niepoprawny stan pozycji');
      requireValue(Array.isArray(item.sourceIds) && new Set(item.sourceIds).size === item.sourceIds.length &&
        item.sourceIds.every(s => sourceIds.has(s)), 'Niepoprawne źródła pozycji');
      if (item.status === 'pending') {
        requireValue(item.offer === null && item.requirements === null && item.startsOn === null && item.endsOn === null &&
          item.claim === null && item.sourceIds.length === 0, 'Oczekująca pozycja nie może zawierać niepotwierdzonych ofert');
        continue;
      }
      known++; text(item.offer); text(item.requirements);
      requireValue(item.sourceIds.length > 0, 'Potwierdzony fakt wymaga źródła');
      requireValue(date(item.endsOn) >= date(item.startsOn), 'Odwrócony okres pozycji');
      requireValue(item.startsOn <= doc.endsOn && item.endsOn >= doc.startsOn, 'Pozycja poza wydaniem');
      if (item.claim !== null) {
        object(item.claim, ['startsOn', 'endsOn', 'details']);
        requireValue(date(item.claim.endsOn) >= date(item.claim.startsOn) && item.claim.startsOn >= item.startsOn, 'Niepoprawny okres odbioru');
        text(item.claim.details);
      }
    }
  }
  requireValue(known > 0, 'Brak potwierdzonych faktów');
  return doc;
}
// Daty Rockstar nie podają godziny resetu. UTC jest granicą prezentacji strony,
// a przejście preview -> active zawsze wymaga decyzji redakcyjnej.
export function publicState(doc, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today > doc.endsOn) return 'ended';
  return doc.status === 'active' && today >= doc.startsOn ? 'active' : 'preview';
}

// Bieżący dokument z indeksem osobnych wydań; starszy format pary pozostaje odczytywalny.
export function validatePublicPage(value, now = Date.now()) {
  if (Object.hasOwn(value || {}, 'issue')) { validatePublicWeekly(value, now); return value; }
  if (value?.schemaVersion === 2) {
    object(value, ['schemaVersion', 'current', 'archive']);
    validatePublicWeekly(value.current, now);
    requireValue(Array.isArray(value.archive) && value.archive.length <= 200, 'Niepoprawny indeks wydań');
    const issues = new Set([value.current.issue]);
    for (const entry of value.archive) {
      object(entry, ['issue', 'startsOn', 'endsOn']);
      requireValue(entry.issue === issueNumber(entry.startsOn) && date(entry.endsOn) >= date(entry.startsOn) &&
        entry.endsOn < value.current.startsOn && !issues.has(entry.issue), 'Niepoprawne wydanie archiwalne');
      issues.add(entry.issue);
    }
    requireValue(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PUBLIC_BYTES, 'Dokument strony za duży');
    return value;
  }
  object(value, ['schemaVersion', 'editions']);
  requireValue(value.schemaVersion === 1 && Array.isArray(value.editions) && value.editions.length >= 1 && value.editions.length <= 2, 'Wymagane jedno lub dwa wydania');
  requireValue(new TextEncoder().encode(JSON.stringify(value)).length <= MAX_PUBLIC_BYTES, 'Dokument strony za duży');
  value.editions.forEach(doc => validatePublicWeekly(doc, now));
  if (value.editions.length === 2) {
    const [current, next] = value.editions;
    requireValue(current.endsOn < next.startsOn && date(next.startsOn) - date(current.endsOn) === 86400000, 'Wydania muszą następować bezpośrednio po sobie');
    requireValue(next.status === 'preview', 'Drugie wydanie musi być zapowiedzią');
  }
  return value;
}
export function visiblePublicEditions(value, now = Date.now()) {
  validatePublicPage(value, now);
  if (value.schemaVersion === 2) return [value.current];
  const editions = value.editions || [value];
  const visible = editions.filter(doc => publicState(doc, now) !== 'ended');
  // Gdy wszystko wygasło, zostaje ostatnie wydanie z jawnym komunikatem.
  return visible.length ? visible : [editions[editions.length - 1]];
}
