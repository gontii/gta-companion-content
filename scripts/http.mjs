const HOSTS = new Set(['graph.rockstargames.com', 'www.rockstargames.com', 'rockstarintel.com', 'www.gtabase.com', 'www.youtube.com', 'api.supadata.ai', 'gtacompanion.net', 'www.igrandtheftauto.com', 'www.gtaboss.gg', 'www.reddit.com']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retry-After above a couple of seconds is remembered by the caller. Waiting
// inside the Worker would burn the source-read budget on a single 429.
export function retryDelayMs(response, attempt, now = Date.now()) {
  const header = response.headers?.get?.('retry-after');
  const seconds = Number(header);
  const fromHeader = Number.isFinite(seconds) ? seconds * 1000
    : (header && Number.isFinite(Date.parse(header)) ? Date.parse(header) - now : null);
  if (fromHeader != null && fromHeader > 2000) return { delay: Math.max(0, fromHeader), immediate: false };
  return { delay: fromHeader != null ? Math.max(0, fromHeader) : Math.min(1000, 250 * 2 ** attempt), immediate: true };
}

export async function fetchWithBackoff(input, options = {}, fetchImpl = fetch, { retries = 3, sleepImpl = sleep, now = Date.now() } = {}) {
  let response;
  for (let attempt = 0; attempt <= retries; attempt++) {
    response = await safeFetch(input, options, fetchImpl);
    if (response.status !== 429 && response.status !== 503) return response;
    const plan = retryDelayMs(response, attempt, now);
    if (!plan.immediate || attempt === retries) return response;
    await response.body?.cancel?.();
    await sleepImpl(plan.delay);
  }
  return response;
}

export async function safeFetch(input, options = {}, fetchImpl = fetch) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) throw new Error('source_url_rejected');
  const response = await fetchImpl(url, {
    ...options, redirect: 'manual', signal: AbortSignal.timeout(25000),
    headers: { 'user-agent': 'GTA-Companion/2.0 (+https://gtacompanion.net)', ...options.headers },
  });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error('source_redirect_rejected');
  }
  return response;
}

export async function readBounded(response, limit = 1_500_000) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('response_too_large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('response_too_large');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
