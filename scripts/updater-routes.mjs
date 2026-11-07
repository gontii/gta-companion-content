// Trasy automatu treści. Przekaźnik i Worker używają tej samej listy,
// żeby test mógł wykonać te same ścieżki bez wdrożenia.

export const UPDATER_PATHS = {
  status: '/status',
  outbox: '/outbox',
  check: '/check',
  probeTgg: '/probe-tgg',
  ack: '/ack',
  smokeToken: '/smoke-token',
  rollback: '/rollback',
};

// Ścieżka może być poprzedzona prefiksem z CONTENT_UPDATER_URL (`/status` albo `/automat/status`).
// Wiodący ukośnik w trasie odcina fałszywe końcówki w rodzaju `/recheck`.
export function matchesUpdaterRoute(pathname, routePath) {
  if (typeof pathname !== 'string' || typeof routePath !== 'string' || !routePath.startsWith('/')) return false;
  return pathname === routePath || pathname.endsWith(routePath);
}

export function updaterUrl(base, routePath) {
  const suffix = String(routePath).replace(/^\//, '');
  const root = base.endsWith('/') ? base : `${base}/`;
  return new URL(suffix, root);
}

function hideTokenAssignment(match, prefix, sep, quote) {
  return `${prefix || ''}token${sep}${quote}[ukryte]`;
}

function safeDetail(text) {
  return String(text || '')
    .replace(/bearer\s+\S+/gi, 'bearer [ukryte]')
    // token=, token:, "token":"…", access_token / refresh_token / id_token / api_token oraz token%3D.
    .replace(/"?((?:access|refresh|id|api)[_-])?token"?(\s*[:=]\s*)("?)[^"&\s,}]*/gi, hideTokenAssignment)
    .replace(/((?:access|refresh|id|api)[_-])?token%3[dD][^&\s]*/gi, '$1token%3D[ukryte]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function explainUpdaterHttpError(method, routePath, status, body) {
  const detail = safeDetail(body);
  const call = `${method} ${routePath}`;
  if (status === 404 && detail === 'Not found') {
    return `Automat HTTP 404 na ${call}. Worker zwraca „Not found” przy złym sekrecie AUTOMATION_TOKEN (musi być zgodny z sekretem GitHub CONTENT_AUTOMATION_TOKEN) oraz przy nieznanej ścieżce. Sprawdź CONTENT_UPDATER_URL; trasa ma się kończyć na ${routePath}.`;
  }
  if (status === 404 && /error code:\s*1042/.test(detail)) {
    return `Automat HTTP 404 na ${call}. Host w CONTENT_UPDATER_URL nie obsługuje tego Workera (Cloudflare 1042).`;
  }
  return `Automat HTTP ${status} na ${call}${detail ? `: ${detail}` : ''}`;
}
