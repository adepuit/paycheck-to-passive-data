import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysISO, normalizeHour, validateEarningsData, isStale,
  groupByDay, toEarningsData, formatDayLabel, mondayOf, weekDays, cleanName,
} from './earnings.js';

test('addDaysISO adds calendar days without TZ drift', () => {
  assert.equal(addDaysISO('2026-07-20', 21), '2026-08-10');
  assert.equal(addDaysISO('2026-12-31', 1), '2027-01-01');
});

test('normalizeHour keeps known values, else "unknown"', () => {
  for (const h of ['bmo', 'amc', 'dmh']) assert.equal(normalizeHour(h), h);
  for (const h of ['', undefined, 'xyz', null]) assert.equal(normalizeHour(h), 'unknown');
});

test('validateEarningsData accepts good shape, rejects bad', () => {
  const good = { generated: '2026-07-20T10:00:00Z', window: { from: '2026-07-20', to: '2026-08-10' }, events: [{ symbol: 'AAPL', date: '2026-07-31' }] };
  assert.equal(validateEarningsData(good), true);
  assert.equal(validateEarningsData(null), false);
  assert.equal(validateEarningsData({ ...good, events: 'nope' }), false);
  assert.equal(validateEarningsData({ ...good, window: {} }), false);
  assert.equal(validateEarningsData({ ...good, events: [{ date: '2026-07-31' }] }), false);
});

test('isStale flags past window or old generated', () => {
  const fresh = { generated: new Date().toISOString(), window: { from: '2026-07-20', to: '2999-01-01' } };
  assert.equal(isStale(fresh, '2026-07-20'), false);
  assert.equal(isStale({ generated: new Date().toISOString(), window: { from: '2020-01-01', to: '2020-02-01' } }, '2026-07-20'), true);
  assert.equal(isStale({ generated: '2020-01-01T00:00:00Z', window: { from: '2026-07-20', to: '2999-01-01' } }, '2026-07-20'), true);
  assert.equal(isStale(null, '2026-07-20'), true);
});

test('groupByDay groups and date-orders; empty -> []', () => {
  const g = groupByDay([
    { symbol: 'B', date: '2026-07-31' },
    { symbol: 'A', date: '2026-07-30' },
    { symbol: 'C', date: '2026-07-31' },
  ]);
  assert.deepEqual(g.map((s) => s.date), ['2026-07-30', '2026-07-31']);
  assert.equal(g[1].items.length, 2);
  assert.deepEqual(groupByDay([]), []);
});

test('cleanName strips exchange suffix', () => {
  assert.equal(cleanName('Apple Inc. Common Stock'), 'Apple Inc.');
  assert.equal(cleanName('Zzz Corp'), 'Zzz Corp');
});

test('toEarningsData includes the whole market, flags watchlist, sorts by cap within a day', () => {
  const watchlist = [{ symbol: 'AAPL', name: 'Apple', domain: 'apple.com' }];
  const resp = { earningsCalendar: [
    { symbol: 'AAPL', name: 'Apple Inc. Common Stock', date: '2026-07-31', hour: 'amc', epsEstimate: 1.42, marketCap: 3.1e12 },
    { symbol: 'ZZZ', name: 'Zzz Corp Common Stock', date: '2026-07-31', hour: 'bmo', epsEstimate: 0.1, marketCap: 5e9 },
    { symbol: 'BIG', name: 'Big Co', date: '2026-07-31', hour: 'amc', epsEstimate: 2, marketCap: 9e12 },
    { symbol: 'OLD', name: 'Old Co', date: '2026-09-30', hour: 'amc' },
  ] };
  const d = toEarningsData(resp, watchlist, '2026-07-20', 21);
  assert.equal(d.events.length, 3); // OLD out of window
  assert.deepEqual(d.events.map((e) => e.symbol), ['BIG', 'AAPL', 'ZZZ']); // market cap desc within day
  const aapl = d.events.find((e) => e.symbol === 'AAPL');
  assert.equal(aapl.watch, true);
  assert.equal(aapl.name, 'Apple');
  assert.equal(aapl.domain, 'apple.com');
  const zzz = d.events.find((e) => e.symbol === 'ZZZ');
  assert.equal(zzz.watch, false);
  assert.equal(zzz.name, 'Zzz Corp'); // suffix stripped, no watchlist override
  assert.equal(zzz.domain, null);
});

test('formatDayLabel returns weekday + month/day without off-by-one', () => {
  const f = formatDayLabel('2026-07-31');
  assert.equal(f.weekday, 'Fri');
  assert.equal(f.monthDay, 'Jul 31');
});

test('toEarningsData carries drilldown fields + domain from watchlist', () => {
  const watchlist = [{ symbol: 'AAPL', name: 'Apple', domain: 'apple.com' }];
  const resp = { earningsCalendar: [
    { symbol: 'AAPL', date: '2026-07-31', hour: 'amc', epsEstimate: 1.42, marketCap: 3.1e12, numEstimates: 27, lastYearEps: 1.26, fiscalQuarter: 'Jun 2026' },
  ] };
  const e = toEarningsData(resp, watchlist, '2026-07-20', 21).events[0];
  assert.equal(e.domain, 'apple.com');
  assert.equal(e.marketCap, 3.1e12);
  assert.equal(e.numEstimates, 27);
  assert.equal(e.lastYearEps, 1.26);
  assert.equal(e.fiscalQuarter, 'Jun 2026');
  assert.equal(e.logo, null);
  assert.equal(e.watch, true);
});

test('mondayOf returns the Monday of the week for any weekday', () => {
  assert.equal(mondayOf('2026-07-20'), '2026-07-20'); // Monday -> itself
  assert.equal(mondayOf('2026-07-22'), '2026-07-20'); // Wednesday
  assert.equal(mondayOf('2026-07-24'), '2026-07-20'); // Friday
  assert.equal(mondayOf('2026-07-26'), '2026-07-20'); // Sunday -> prior Monday
  assert.equal(mondayOf('2026-07-27'), '2026-07-27'); // next Monday
});

test('weekDays returns 5 weekdays from Monday by default', () => {
  assert.deepEqual(weekDays('2026-07-20'), ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
});
