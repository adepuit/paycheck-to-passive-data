import { writeFileSync } from 'node:fs';
import { WATCHLIST } from './watchlist.js';
import { todayET, addDaysISO } from './earnings.js';
import { toTickerMap, toDividendsData, validateDividendsData } from './dividends.js';

const DAYS = 21; // forward only: announced ex-dates from today through 3 weeks out
const MIN_TICKERS = 8000; // measured ~13,250 US-listed tickers; far fewer means a truncated list
const API = 'https://api.polygon.io';
const OUT = new URL('./dividends.json', import.meta.url);
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

// --- main entry ---

export async function fetchDividends({ token, fetchImpl = fetch, now = todayET(), sleep = defaultSleep } = {}) {
  if (!token) throw new Error('POLYGON_API_KEY is not set');
  const opts = { token, fetchImpl, sleep };
  const to = addDaysISO(now, DAYS);
  const rows = await fetchAllPages(`${API}/v3/reference/dividends?ex_dividend_date.gte=${now}&ex_dividend_date.lte=${to}&limit=1000`, opts);
  await sleep(PAGE_GAP_MS);
  const tickers = toTickerMap(await fetchAllPages(`${API}/v3/reference/tickers?market=stocks&active=true&limit=1000`, opts));
  if (tickers.size < MIN_TICKERS) throw new Error(`Polygon ticker list too short (${tickers.size})`);
  const data = toDividendsData(rows, tickers, WATCHLIST, now, DAYS);
  if (!validateDividendsData(data)) throw new Error('Produced dividends data failed validation');
  return data;
}

// CLI: fetch and write, but never overwrite with junk (throws => non-zero exit, file untouched).
if (process.argv[1] === new URL(import.meta.url).pathname) {
  fetchDividends({ token: process.env.POLYGON_API_KEY })
    .then((data) => {
      writeFileSync(OUT, JSON.stringify(data) + '\n'); // compact, like earnings.json
      console.log(`wrote ${data.dividends.length} dividends for ${data.window.from}..${data.window.to}`);
    })
    .catch((err) => { console.error('fetch-dividends failed:', err.message); process.exit(1); });
}
