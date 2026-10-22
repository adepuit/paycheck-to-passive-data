import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEpsForecast, parseSigned, nasdaqTimeToHour, nasdaqRowsToCalendar, weekdayWindow, fetchEarnings,
} from './fetch-earnings.js';

test('parseEpsForecast handles $, parens (negative), N/A, empty', () => {
  assert.equal(parseEpsForecast('$2.01'), 2.01);
  assert.equal(parseEpsForecast('($0.34)'), -0.34);
  assert.equal(parseEpsForecast('N/A'), null);
  assert.equal(parseEpsForecast(''), null);
  assert.equal(parseEpsForecast(null), null);
});

test('nasdaqTimeToHour maps pre/after, else unknown', () => {
  assert.equal(nasdaqTimeToHour('time-pre-market'), 'bmo');
  assert.equal(nasdaqTimeToHour('time-after-hours'), 'amc');
  assert.equal(nasdaqTimeToHour('time-not-supplied'), 'unknown');
});

test('nasdaqRowsToCalendar maps rows incl. drilldown fields, skips symbol-less, tolerates empty', () => {
  const payload = { data: { rows: [
    { symbol: 'aapl', name: 'Apple Inc. Common Stock', time: 'time-after-hours', epsForecast: '$1.43', marketCap: '$3,100,000,000,000', noOfEsts: '27', lastYearEPS: '$1.26', fiscalQuarterEnding: 'Jun 2026' },
    { name: 'no symbol', time: 'time-pre-market' },
  ] } };
  const rows = nasdaqRowsToCalendar(payload, '2026-07-31');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    symbol: 'AAPL', name: 'Apple Inc. Common Stock', date: '2026-07-31', hour: 'amc', epsEstimate: 1.43,
    marketCap: 3100000000000, numEstimates: 27, lastYearEps: 1.26, fiscalQuarter: 'Jun 2026',
    eps: null, surprise: null,
  });
  assert.deepEqual(nasdaqRowsToCalendar(null, '2026-07-31'), []);
  assert.deepEqual(nasdaqRowsToCalendar({ data: { rows: null } }, '2026-07-31'), []);
});

test('weekdayWindow excludes weekends', () => {
  const w = weekdayWindow('2026-07-20', 7); // Mon 20 .. Mon 27
  assert.deepEqual(w, ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-27']);
});

test('fetchEarnings(nasdaq) includes whole market and flags watchlist names', async () => {
  const stub = async (url) => {
    const date = new URL(url).searchParams.get('date');
    const rows = date === '2026-07-22'
      ? [{ symbol: 'AAPL', name: 'Apple Inc. Common Stock', time: 'time-after-hours', epsForecast: '$1.43' },
         { symbol: 'ZZZZ', name: 'Zzzz Holdings Common Stock', time: 'time-pre-market', epsForecast: '$9.00' }]
      : [];
    return { ok: true, json: async () => ({ data: { rows } }) };
  };
  const d = await fetchEarnings({ source: 'nasdaq', fetchImpl: stub, now: '2026-07-20' });
  assert.equal(d.sample, false);
  assert.equal(d.events.length, 2); // both included (whole market)
  const aapl = d.events.find((e) => e.symbol === 'AAPL');
  assert.equal(aapl.watch, true);
  assert.equal(aapl.name, 'Apple'); // watchlist override
  const zzzz = d.events.find((e) => e.symbol === 'ZZZZ');
  assert.equal(zzzz.watch, false);
  assert.equal(zzzz.name, 'Zzzz Holdings'); // provider name, suffix stripped
});

test('fetchEarnings(nasdaq) throws when every request fails (never overwrites good data)', async () => {
  const stub = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(fetchEarnings({ source: 'nasdaq', fetchImpl: stub, now: '2026-07-20' }), /All Nasdaq requests failed/);
});

test('fetchEarnings(finnhub) still works via the fallback adapter', async () => {
  const stub = async (url) => {
    assert.match(url, /finnhub\.io/);
    return { ok: true, json: async () => ({ earningsCalendar: [
      { symbol: 'KO', date: '2026-07-22', hour: 'bmo', epsEstimate: 0.83, quarter: 2, year: 2026 },
    ] }) };
  };
  const d = await fetchEarnings({ source: 'finnhub', token: 'faketoken', fetchImpl: stub, now: '2026-07-20' });
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].symbol, 'KO');
});

test('parseSigned keeps the sign, else null', () => {
  assert.equal(parseSigned('11.39'), 11.39);
  assert.equal(parseSigned('-3.2'), -3.2);
  assert.equal(parseSigned('N/A'), null);
  assert.equal(parseSigned(''), null);
});

test('nasdaqRowsToCalendar reads reported EPS and surprise on past days', () => {
  const rows = nasdaqRowsToCalendar({ data: { rows: [
    { symbol: 'NFLX', time: 'time-not-supplied', eps: '$0.87', surprise: '6.1', epsForecast: '$0.82' },
    { symbol: 'MISS', time: 'time-not-supplied', eps: '($0.10)', surprise: '-25' },
  ] } }, '2026-10-20');
  assert.equal(rows[0].eps, 0.87);
  assert.equal(rows[0].surprise, 6.1);
  assert.equal(rows[1].eps, -0.1);
  assert.equal(rows[1].surprise, -25);
});

test('weekdayWindow can reach back into the past', () => {
  assert.deepEqual(weekdayWindow('2026-07-20', 1, 3), ['2026-07-17', '2026-07-20', '2026-07-21']);
});

test('fetchEarnings keeps the past month and fills gaps from the previous file', async () => {
  const stub = async (url) => {
    const date = new URL(url).searchParams.get('date');
    const rows = date === '2026-07-15' ? [{ symbol: 'NFLX', time: 'time-not-supplied', eps: '$0.87', surprise: '6.1' }]
      : date === '2026-07-22' ? [{ symbol: 'KO', time: 'time-pre-market', epsForecast: '$0.83' }] : [];
    if (date === '2026-07-14') return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ data: { rows } }) };
  };
  const previous = { generated: '2026-07-19T10:00:00Z', window: { from: '2026-06-19', to: '2026-08-09' }, sample: false, events: [
    { symbol: 'NFLX', name: 'Netflix', date: '2026-07-15', hour: 'amc', epsEstimate: 0.82, lastYearEps: 0.7 },
    { symbol: 'JPM', name: 'JPMorgan', date: '2026-07-14', hour: 'bmo' }, // that day failed to fetch: kept
    { symbol: 'GONE', name: 'Gone', date: '2026-06-01', hour: 'bmo' }, // older than a month: dropped
  ] };
  const d = await fetchEarnings({ source: 'nasdaq', fetchImpl: stub, now: '2026-07-20', previous });
  assert.equal(d.window.from, '2026-06-20');
  assert.deepEqual(d.events.map((e) => e.symbol), ['JPM', 'NFLX', 'KO']);
  const nflx = d.events[1];
  assert.equal(nflx.hour, 'amc'); // past days come back without a time; kept from before
  assert.equal(nflx.epsEstimate, 0.82);
  assert.equal(nflx.lastYearEps, 0.7);
  assert.equal(nflx.eps, 0.87);
  assert.equal(nflx.surprise, 6.1);
});
