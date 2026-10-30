import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages, fetchDividends } from './fetch-dividends.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const res = (status) => ({ ok: false, status, json: async () => ({}) });
const recorder = () => { const calls = []; return { calls, sleep: async (ms) => { calls.push(ms); } }; };

test('fetchAllPages follows next_url with apiKey, sleeps 13s between pages, passes a timeout signal', async () => {
  const urls = []; const opts = [];
  const pages = [
    ok({ results: [1, 2], next_url: 'https://api.polygon.io/v3/x?cursor=abc' }),
    ok({ results: [3] }),
  ];
  const s = recorder();
  const out = await fetchAllPages('https://api.polygon.io/v3/x?limit=1000', { token: 'K', fetchImpl: async (u, o) => { urls.push(u); opts.push(o); return pages.shift(); }, sleep: s.sleep });
  assert.deepEqual(out, [1, 2, 3]);
  assert.ok(opts.every((o) => o && o.signal instanceof AbortSignal));
  assert.deepEqual(urls, ['https://api.polygon.io/v3/x?limit=1000&apiKey=K', 'https://api.polygon.io/v3/x?cursor=abc&apiKey=K']);
  assert.deepEqual(s.calls, [13000]);
});

test('fetchAllPages retries 429/5xx/network up to 3 attempts with 60s waits', async () => {
  const seq = [res(429), Promise.reject(new Error('ECONNRESET')), ok({ results: ['a'] })];
  const s = recorder();
  const out = await fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: async () => seq.shift(), sleep: s.sleep });
  assert.deepEqual(out, ['a']);
  assert.deepEqual(s.calls, [60000, 60000]);
  const s2 = recorder();
  await assert.rejects(
    fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'SECRET', fetchImpl: async () => res(503), sleep: s2.sleep }),
    (e) => /503/.test(e.message) && /\/v3\/x/.test(e.message) && !/SECRET/.test(e.message));
  assert.deepEqual(s2.calls, [60000, 60000]);
});

test('fetchAllPages throws on non-retryable status, bad shape, or page cap; never leaks the key', async () => {
  const s = recorder();
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'SECRET', fetchImpl: async () => res(403), sleep: s.sleep }),
    (e) => /403/.test(e.message) && !/SECRET/.test(e.message));
  assert.deepEqual(s.calls, []); // no retry on 403
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: async () => ok({ status: 'ERROR' }), sleep: s.sleep }), /shape/);
  const loop = async () => ok({ results: [1], next_url: 'https://api.polygon.io/v3/x?cursor=n' });
  await assert.rejects(fetchAllPages('https://api.polygon.io/v3/x?l=1', { token: 'K', fetchImpl: loop, sleep: s.sleep, maxPages: 3 }), /page cap/);
});

const tickerRows = (n) => Array.from({ length: n }, (_, i) => ({ ticker: 'T' + i, name: 'T' + i, primary_exchange: 'XNAS', type: 'CS' }))
  .concat([{ ticker: 'KO', name: 'Coca-Cola Company', primary_exchange: 'XNYS', type: 'CS' }, { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', primary_exchange: 'ARCX', type: 'ETF' }]);
// Records URLs instead of asserting inside fetchImpl (a throw there would be retried as a network error).
const stubFor = (nTickers, divResults, seen = []) => async (u) => {
  seen.push(u);
  const path = new URL(u).pathname;
  if (path === '/v3/reference/dividends') return ok({ results: divResults });
  if (path === '/v3/reference/tickers') return ok({ results: tickerRows(nTickers) });
  return res(404);
};
const DIVS = [
  { ticker: 'KO', ex_dividend_date: '2026-12-01', currency: 'USD', cash_amount: 0.53 }, // outside window
  { ticker: 'KO', ex_dividend_date: '2026-11-13', currency: 'USD', cash_amount: 0.53 },
  { ticker: 'SCHD', ex_dividend_date: '2026-11-04', currency: 'USD', cash_amount: 0.27 },
];

test('fetchDividends returns validated whole-market data with watchlist flags', async () => {
  const seen = [];
  const d = await fetchDividends({ token: 'K', fetchImpl: stubFor(8000, DIVS, seen), now: '2026-10-28', sleep: async () => {} });
  assert.equal(seen.length, 2);
  assert.match(seen[0], /\/v3\/reference\/dividends\?ex_dividend_date\.gte=2026-09-28&ex_dividend_date\.lte=2026-11-27&limit=1000&apiKey=K$/);
  assert.match(seen[1], /\/v3\/reference\/tickers\?market=stocks&active=true&limit=1000&apiKey=K$/);
  assert.deepEqual(d.window, { from: '2026-09-28', to: '2026-11-27' }); // 30 back, 30 ahead
  assert.deepEqual(d.dividends.map((x) => x.symbol), ['SCHD', 'KO']);
  const ko = d.dividends.find((x) => x.symbol === 'KO');
  assert.equal(ko.watch, true); // KO is in watchlist.js (line 55)
  assert.equal(ko.name, 'Coca-Cola');
  assert.equal(d.dividends.find((x) => x.symbol === 'SCHD').type, 'ETF');
});

test('fetchDividends throws without token, on short ticker list, or when nothing survives', async () => {
  const sleep = async () => {};
  await assert.rejects(fetchDividends({ token: '', fetchImpl: stubFor(8000, DIVS), now: '2026-10-28', sleep }), /POLYGON_API_KEY/);
  await assert.rejects(fetchDividends({ token: 'K', fetchImpl: stubFor(100, DIVS), now: '2026-10-28', sleep }), /ticker list/);
  await assert.rejects(fetchDividends({ token: 'K', fetchImpl: stubFor(8000, []), now: '2026-10-28', sleep }), /validation/);
});
