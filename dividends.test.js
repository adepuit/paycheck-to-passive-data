import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTickerMap, resolveListed, toDividendsData, validateDividendsData } from './dividends.js';

const TICKERS = [
  { ticker: 'KO', name: 'Coca-Cola Company', primary_exchange: 'XNYS', type: 'CS' },
  { ticker: 'SCHD', name: 'Schwab US Dividend Equity ETF', primary_exchange: 'ARCX', type: 'ETF' },
  { ticker: 'BRK.B', name: 'BERKSHIRE HATHAWAY Class B', primary_exchange: 'XNYS', type: 'CS' },
  { ticker: 'SCHWpJ', name: 'Charles Schwab Pfd J', primary_exchange: 'XNYS', type: 'PFD' },
  { name: 'no ticker' },
];

test('toTickerMap keys by ticker, keeps name/exchange/type, skips ticker-less rows', () => {
  const m = toTickerMap(TICKERS);
  assert.equal(m.size, 4);
  assert.deepEqual(m.get('SCHD'), { name: 'Schwab US Dividend Equity ETF', exchange: 'ARCX', type: 'ETF' });
  assert.deepEqual(toTickerMap(null).size, 0);
});

test('resolveListed: direct match, preferred PR<X> -> p<X>, dot -> dash output, else null', () => {
  const m = toTickerMap(TICKERS);
  assert.equal(resolveListed('KO', m).symbol, 'KO');
  assert.equal(resolveListed('BRK.B', m).symbol, 'BRK-B');
  const pfd = resolveListed('SCHWPRJ', m);
  assert.equal(pfd.symbol, 'SCHWpJ');
  assert.equal(pfd.info.type, 'PFD');
  assert.equal(resolveListed('JUMSY', m), null); // OTC ADR, not listed
  assert.equal(resolveListed('', m), null);
});

const WL = [{ symbol: 'KO', name: 'Coca-Cola', domain: 'coca-colacompany.com' }, { symbol: 'BRK-B', name: 'Berkshire Hathaway', domain: 'berkshirehathaway.com' }];
const div = (o) => ({ currency: 'USD', dividend_type: 'CD', frequency: 4, pay_date: '2026-11-20', record_date: '2026-11-05', declaration_date: '2026-10-20', cash_amount: 0.5, ...o });

test('toDividendsData filters window/currency/listed, overlays watchlist, maps fields', () => {
  const m = toTickerMap(TICKERS);
  const rows = [
    div({ ticker: 'KO', ex_dividend_date: '2026-11-05', cash_amount: 0.53 }),
    div({ ticker: 'SCHD', ex_dividend_date: '2026-11-04', frequency: 4, declaration_date: undefined }),
    div({ ticker: 'KO', ex_dividend_date: '2026-10-27' }),               // before today: dropped
    div({ ticker: 'KO', ex_dividend_date: '2026-11-19' }),               // after today+21: dropped
    div({ ticker: 'KO', ex_dividend_date: '2026-11-06', currency: 'CAD' }), // non-USD: dropped
    div({ ticker: 'JUMSY', ex_dividend_date: '2026-11-05' }),            // unlisted: dropped
    div({ ticker: 'KO', ex_dividend_date: 'bad' }),                      // bad date: dropped
  ];
  const d = toDividendsData(rows, m, WL, '2026-10-28', 21);
  assert.deepEqual(d.window, { from: '2026-10-28', to: '2026-11-18' });
  assert.equal(d.sample, false);
  assert.equal(typeof d.generated, 'string');
  assert.deepEqual(d.dividends.map((x) => x.symbol), ['SCHD', 'KO']); // sorted by exDate
  assert.deepEqual(d.dividends[1], {
    symbol: 'KO', name: 'Coca-Cola', domain: 'coca-colacompany.com', logo: null, watch: true,
    type: 'CS', exchange: 'XNYS', exDate: '2026-11-05', payDate: '2026-11-20', recordDate: '2026-11-05',
    declaredDate: '2026-10-20', amount: 0.53, frequency: 4, special: false,
  });
  assert.equal(d.dividends[0].name, 'Schwab US Dividend Equity ETF');
  assert.equal(d.dividends[0].watch, false);
  assert.equal(d.dividends[0].declaredDate, null);
});

test('toDividendsData: BRK.B matches watchlist BRK-B; special flag; exact-dup removed, regular+special kept; same-day sort by symbol', () => {
  const m = toTickerMap(TICKERS);
  const rows = [
    div({ ticker: 'KO', ex_dividend_date: '2026-11-02', cash_amount: 0.53 }),
    div({ ticker: 'KO', ex_dividend_date: '2026-11-02', cash_amount: 0.53 }),                       // exact dup
    div({ ticker: 'KO', ex_dividend_date: '2026-11-02', cash_amount: 1.00, dividend_type: 'SC' }),  // special
    div({ ticker: 'BRK.B', ex_dividend_date: '2026-11-02' }),
  ];
  const d = toDividendsData(rows, m, WL, '2026-10-28', 21);
  assert.deepEqual(d.dividends.map((x) => [x.symbol, x.amount, x.special]), [
    ['BRK-B', 0.5, false], ['KO', 0.53, false], ['KO', 1, true],
  ]);
  assert.equal(d.dividends[0].watch, true);
  assert.equal(d.dividends[0].name, 'Berkshire Hathaway');
  assert.deepEqual(toDividendsData(null, m, WL, '2026-10-28', 21).dividends, []);
});

test('validateDividendsData requires shape and at least one dividend', () => {
  const good = { generated: '2026-10-28T10:00:00Z', window: { from: '2026-10-28', to: '2026-11-18' }, dividends: [{ symbol: 'KO', exDate: '2026-11-05' }] };
  assert.equal(validateDividendsData(good), true);
  assert.equal(validateDividendsData({ ...good, dividends: [] }), false);
  assert.equal(validateDividendsData(null), false);
  assert.equal(validateDividendsData({ ...good, window: {} }), false);
  assert.equal(validateDividendsData({ ...good, generated: 5 }), false);
  assert.equal(validateDividendsData({ ...good, dividends: [{ symbol: 'KO' }] }), false);
});
