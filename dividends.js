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
