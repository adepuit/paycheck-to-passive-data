import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDaysISO, normalizeHour, validateEarningsData, isStale,
  groupByDay, toEarningsData, formatDayLabel, mondayOf, weekDays,
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

test('toEarningsData filters to watchlist + window, maps, sorts', () => {
  const watchlist = [{ symbol: 'AAPL', name: 'Apple' }, { symbol: 'KO', name: 'Coca-Cola' }];
  const resp = { earningsCalendar: [
    { symbol: 'AAPL', date: '2026-07-31', hour: 'amc', epsEstimate: 1.42, quarter: 3, year: 2026 },
    { symbol: 'KO', date: '2026-07-22', hour: 'bmo', epsEstimate: null, quarter: 2, year: 2026 },
    { symbol: 'ZZZ', date: '2026-07-25', hour: 'amc', epsEstimate: 9 },
    { symbol: 'AAPL', date: '2026-09-30', hour: 'amc', epsEstimate: 2 },
  ] };
  const d = toEarningsData(resp, watchlist, '2026-07-20', 21);
  assert.equal(d.sample, false);
  assert.deepEqual(d.window, { from: '2026-07-20', to: '2026-08-10' });
  assert.deepEqual(d.events.map((e) => e.symbol), ['KO', 'AAPL']);
  assert.equal(d.events[0].name, 'Coca-Cola');
  assert.equal(d.events[0].epsEstimate, null);
  assert.equal(d.events[1].hour, 'amc');
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
