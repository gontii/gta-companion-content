const HOSTS = new Set(['graph.rockstargames.com', 'www.rockstargames.com', 'rockstarintel.com', 'www.gtabase.com', 'www.youtube.com', 'api.supadata.ai', 'gtacompanion.net']);

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
