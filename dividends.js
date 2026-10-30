import { addDaysISO } from './earnings.js';

// Polygon reference tickers -> Map(ticker -> { name, exchange, type }). Only exchange-listed
// US securities come back from /v3/reference/tickers?market=stocks, so this map doubles as
// the "is it listed" filter for dividends (drops OTC / foreign lines).
export function toTickerMap(rows) {
  const m = new Map();
  for (const r of (rows || [])) {
    if (!r || typeof r.ticker !== 'string' || !r.ticker) continue;
    m.set(r.ticker, { name: r.name ?? null, exchange: r.primary_exchange ?? null, type: r.type ?? null });
  }
  return m;
}

// Match a dividend ticker to a listed one. Preferreds differ across Polygon endpoints
// (dividends "SCHWPRJ" vs tickers "SCHWpJ"). Output uses dashes for class shares (BRK-B),
// matching watchlist.js.
export function resolveListed(ticker, tickerMap) {
  if (typeof ticker !== 'string' || !ticker) return null;
  let key = tickerMap.has(ticker) ? ticker : null;
  if (!key) {
    const m = /^(.+)PR([A-Z])$/.exec(ticker);
    if (m && tickerMap.has(`${m[1]}p${m[2]}`)) key = `${m[1]}p${m[2]}`;
  }
  return key ? { symbol: key.replace(/\./g, '-'), info: tickerMap.get(key) } : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v) => (typeof v === 'string' && ISO.test(v)) ? v : null;
const numOrNull = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

// By ex-date, then symbol, then amount.
function byExDate(a, b) {
  return a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1
    : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : (a.amount || 0) - (b.amount || 0);
}

// Polygon /v3/reference/dividends rows -> dividends.json. Keeps US-listed, USD dividends with
// an ex-date in [today-pastDays, today+days], overlaying the watchlist like earnings does.
export function toDividendsData(rows, tickerMap, watchlist, todayISO, days, pastDays = 0) {
  const from = addDaysISO(todayISO, -pastDays);
  const to = addDaysISO(todayISO, days);
  const wl = new Map(watchlist.map((w) => [w.symbol, w]));
  const seen = new Set();
  const dividends = [];
  for (const r of (rows || [])) {
    if (!r || r.currency !== 'USD') continue;
    const exDate = isoOrNull(r.ex_dividend_date);
    if (!exDate || exDate < from || exDate > to) continue;
    const listed = resolveListed(r.ticker, tickerMap);
    if (!listed) continue;
    const w = wl.get(listed.symbol);
    const d = {
      symbol: listed.symbol,
      name: w ? w.name : (listed.info.name || listed.symbol),
      domain: (w && w.domain) || null,
      logo: (w && w.logo) || null,
      watch: !!w,
      type: listed.info.type,
      exchange: listed.info.exchange,
      exDate,
      payDate: isoOrNull(r.pay_date),
      recordDate: isoOrNull(r.record_date),
      declaredDate: isoOrNull(r.declaration_date),
      amount: numOrNull(r.cash_amount),
      frequency: numOrNull(r.frequency),
      special: r.dividend_type === 'SC',
    };
    const key = [d.symbol, d.exDate, d.amount, d.special].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    dividends.push(d);
  }
  return { generated: new Date().toISOString(), window: { from, to }, sample: false, dividends: dividends.sort(byExDate) };
}

// Shape check, plus at least one dividend: two months with none means the source broke.
export function validateDividendsData(d) {
  if (!d || typeof d !== 'object') return false;
  if (!d.window || typeof d.window.from !== 'string' || typeof d.window.to !== 'string') return false;
  if (typeof d.generated !== 'string') return false;
  if (!Array.isArray(d.dividends) || d.dividends.length === 0) return false;
  return d.dividends.every((x) => x && typeof x.symbol === 'string' && typeof x.exDate === 'string');
}
