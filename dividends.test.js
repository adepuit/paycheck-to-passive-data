import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toTickerMap, resolveListed } from './dividends.js';

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
