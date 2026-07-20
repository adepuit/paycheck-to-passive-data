import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseEpsForecast, nasdaqTimeToHour, nasdaqRowsToCalendar, weekdayWindow, fetchEarnings,
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
    { symbol: 'aapl', time: 'time-after-hours', epsForecast: '$1.43', marketCap: '$3,100,000,000,000', noOfEsts: '27', lastYearEPS: '$1.26', fiscalQuarterEnding: 'Jun 2026' },
    { name: 'no symbol', time: 'time-pre-market' },
  ] } };
  const rows = nasdaqRowsToCalendar(payload, '2026-07-31');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    symbol: 'AAPL', date: '2026-07-31', hour: 'amc', epsEstimate: 1.43,
    marketCap: 3100000000000, numEstimates: 27, lastYearEps: 1.26, fiscalQuarter: 'Jun 2026',
  });
  assert.deepEqual(nasdaqRowsToCalendar(null, '2026-07-31'), []);
  assert.deepEqual(nasdaqRowsToCalendar({ data: { rows: null } }, '2026-07-31'), []);
});

test('weekdayWindow excludes weekends', () => {
  const w = weekdayWindow('2026-07-20', 7); // Mon 20 .. Mon 27
  assert.deepEqual(w, ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-27']);
});

test('fetchEarnings(nasdaq) filters to watchlist and validates', async () => {
  const stub = async (url) => {
    const date = new URL(url).searchParams.get('date');
    const rows = date === '2026-07-22'
      ? [{ symbol: 'AAPL', time: 'time-after-hours', epsForecast: '$1.43' },
         { symbol: 'ZZZZ', time: 'time-pre-market', epsForecast: '$9.00' }]
      : [];
    return { ok: true, json: async () => ({ data: { rows } }) };
  };
  const d = await fetchEarnings({ source: 'nasdaq', fetchImpl: stub, now: '2026-07-20' });
  assert.equal(d.sample, false);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].symbol, 'AAPL');
  assert.equal(d.events[0].name, 'Apple');
  assert.equal(d.events[0].hour, 'amc');
  assert.equal(d.events[0].epsEstimate, 1.43);
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
