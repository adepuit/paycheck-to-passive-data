const PAGE_GAP_MS = 13000; // free tier allows 5 requests/minute
const RETRY_WAIT_MS = 60000;
const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;

export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Polygon client ---

// One request with retries on 429 / 5xx / network errors (incl. timeouts). Errors name the
// path only, never the query, so the API key can't end up in logs.
async function getPage(u, token, fetchImpl, sleep) {
  const path = new URL(u).pathname;
  let last = 'network error';
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetchImpl(u + '&apiKey=' + token, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      res = null;
    }
    if (res && res.ok) {
      const body = await res.json();
      if (!body || !Array.isArray(body.results)) throw new Error('Unexpected Polygon response shape for ' + path);
      return body;
    }
    if (res && res.status !== 429 && res.status < 500) throw new Error(`Polygon ${res.status} for ${path}`);
    last = res ? String(res.status) : 'network error';
    if (attempt < ATTEMPTS) await sleep(RETRY_WAIT_MS);
  }
  throw new Error(`Polygon ${last} for ${path}`);
}

// Every page of a Polygon list endpoint. Hitting maxPages throws rather than returning a
// truncated list (a short ticker list would silently drop real dividends).
export async function fetchAllPages(url, { token, fetchImpl = fetch, sleep = defaultSleep, maxPages = 40 } = {}) {
  const path = new URL(url).pathname;
  const out = [];
  let u = url;
  for (let page = 1; u; page++) {
    if (page > maxPages) throw new Error(`Polygon page cap (${maxPages}) hit for ${path}`);
    if (page > 1) await sleep(PAGE_GAP_MS);
    const body = await getPage(u, token, fetchImpl, sleep);
    out.push(...body.results);
    u = body.next_url || null;
  }
  return out;
}
