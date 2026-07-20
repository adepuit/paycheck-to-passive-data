import { writeFileSync } from 'node:fs';
import { WATCHLIST } from './watchlist.js';
import { todayET, addDaysISO, toEarningsData, validateEarningsData } from './earnings.js';

const DAYS = 21;
const OUT = new URL('./earnings.json', import.meta.url);
// Default source is keyless Nasdaq. Set EARNINGS_SOURCE=finnhub (+ FINNHUB_API_KEY)
// to switch providers without changing any other code.
const DEFAULT_SOURCE = 'nasdaq';

// --- helpers (pure, exported for tests) ---

// Nasdaq epsForecast looks like "$2.01", "($0.34)" (negative), "N/A", or "".
export function parseEpsForecast(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str || /n\/?a/i.test(str)) return null;
  const negative = /^\(.*\)$/.test(str);
  const n = parseFloat(str.replace(/[^0-9.]/g, ''));
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

// Nasdaq "time" -> our hour code (toEarningsData/normalizeHour maps the rest to "unknown").
export function nasdaqTimeToHour(time) {
  if (time === 'time-pre-market') return 'bmo';
  if (time === 'time-after-hours') return 'amc';
  return 'unknown';
}

// Parse a plain number that may carry $, commas, etc. (e.g. market cap, # estimates).
export function parseNum(s) {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? n : null;
}

// One Nasdaq day payload -> Finnhub-shaped rows (so toEarningsData is reused unchanged).
export function nasdaqRowsToCalendar(payload, date) {
  const rows = (payload && payload.data && Array.isArray(payload.data.rows)) ? payload.data.rows : [];
  return rows
    .filter((r) => r && r.symbol)
    .map((r) => ({
      symbol: String(r.symbol).trim().toUpperCase(),
      date,
      hour: nasdaqTimeToHour(r.time),
      epsEstimate: parseEpsForecast(r.epsForecast),
      marketCap: parseNum(r.marketCap),
      numEstimates: parseNum(r.noOfEsts),
      lastYearEps: parseEpsForecast(r.lastYearEPS),
      fiscalQuarter: (typeof r.fiscalQuarterEnding === 'string' && r.fiscalQuarterEnding) ? r.fiscalQuarterEnding : null,
    }));
}

// List of YYYY-MM-DD weekdays in [now, now+days].
export function weekdayWindow(now, days) {
  const out = [];
  for (let i = 0; i <= days; i++) {
    const iso = addDaysISO(now, i);
    const dow = new Date(iso + 'T12:00:00Z').getUTCDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) out.push(iso);
  }
  return out;
}

// --- source adapters (each returns a Finnhub-shaped { earningsCalendar: [...] }) ---

async function fetchFromNasdaq(now, days, fetchImpl) {
  const dates = weekdayWindow(now, days);
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' };
  const earningsCalendar = [];
  let ok = 0;
  for (const date of dates) {
    try {
      const res = await fetchImpl(`https://api.nasdaq.com/api/calendar/earnings?date=${date}`, { headers });
      if (!res.ok) continue;
      const payload = await res.json();
      earningsCalendar.push(...nasdaqRowsToCalendar(payload, date));
      ok += 1;
    } catch {
      // skip this day; a single bad day shouldn't abort the window
    }
  }
  if (ok === 0) throw new Error('All Nasdaq requests failed');
  return { earningsCalendar };
}

async function fetchFromFinnhub(token, now, days, fetchImpl) {
  if (!token) throw new Error('FINNHUB_API_KEY is not set');
  const from = now;
  const to = addDaysISO(now, days);
  const res = await fetchImpl(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${token}`);
  if (!res.ok) throw new Error('Finnhub HTTP ' + res.status);
  const raw = await res.json();
  if (!raw || !Array.isArray(raw.earningsCalendar)) throw new Error('Unexpected Finnhub response shape');
  return raw;
}

// --- main entry ---

export async function fetchEarnings({ source = DEFAULT_SOURCE, token, fetchImpl = fetch, now = todayET() } = {}) {
  const raw = source === 'finnhub'
    ? await fetchFromFinnhub(token, now, DAYS, fetchImpl)
    : await fetchFromNasdaq(now, DAYS, fetchImpl);
  const data = toEarningsData(raw, WATCHLIST, now, DAYS);
  if (!validateEarningsData(data)) throw new Error('Produced data failed validation');
  return data;
}

// CLI: fetch and write, but never overwrite with junk (throws => non-zero exit, file untouched).
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const source = process.env.EARNINGS_SOURCE || DEFAULT_SOURCE;
  fetchEarnings({ source, token: process.env.FINNHUB_API_KEY })
    .then((data) => {
      writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
      console.log(`[${source}] wrote ${data.events.length} events for ${data.window.from}..${data.window.to}`);
    })
    .catch((err) => { console.error('fetch-earnings failed:', err.message); process.exit(1); });
}
