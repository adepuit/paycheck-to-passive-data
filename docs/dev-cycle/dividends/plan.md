# Plan: Dividend data

Goal: publish `dividends.json` (all US-listed stocks + ETFs, announced ex-dates today..+21d)
from Polygon's free tier, alongside the unchanged earnings pipeline. Design: [design.md](design.md).

Conventions (match the repo): ES modules, `node:test` + `node:assert/strict`, pure logic in
`dividends.js`, I/O in `fetch-dividends.js`, tests beside sources. Run tests with `npm test`
(baseline: 22 passing). Work on branch `dividends`.

### [x] Step 1: Ticker map and listed-symbol resolution

**Files:** create `dividends.js`, create `dividends.test.js`

**Test first:**
```js
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
```

**Change:** in `dividends.js` export `toTickerMap(rows)` → `Map(ticker → { name, exchange: primary_exchange ?? null, type: type ?? null })`, skipping rows without a string `ticker`; and `resolveListed(ticker, map)` → `{ symbol, info }` or `null`: try `map.get(ticker)`, else if `/^(.+)PR([A-Z])$/` matches try `` `${root}p${letter}` ``; output `symbol` is the matched key with `.` replaced by `-`.

**Verify:** `npm test` → 24 passed, 0 failed

**Commit:** `Add ticker map and listed-symbol resolution for dividends`

### [x] Step 2: Transform Polygon dividends into dividends.json shape

**Files:** modify `dividends.js`, `dividends.test.js`

**Test first:**
```js
import { toDividendsData } from './dividends.js';

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
```
(Add `toDividendsData` to the Step 1 import line instead of a second import.)

**Change:** export `toDividendsData(rows, tickerMap, watchlist, todayISO, days)` using `addDaysISO` from `earnings.js`. Window `[todayISO, todayISO+days]`. Keep rows where `ticker` is a string, `currency === 'USD'`, `ex_dividend_date` matches `/^\d{4}-\d{2}-\d{2}$/` and is in window, and `resolveListed` is non-null. Date fields other than exDate → the string if ISO-shaped, else `null`. `amount`/`frequency` → finite number or `null`. `special: dividend_type === 'SC'`. Watchlist by output symbol overrides `name`, supplies `domain`/`logo` (default `null`), `watch: true`. Dedupe on `symbol|exDate|amount|special`. Sort exDate, symbol, then amount. Return `{ generated, window, sample: false, dividends }`.

**Verify:** `npm test` → 26 passed, 0 failed

**Commit:** `Transform Polygon dividends into dividends.json shape`

### [x] Step 3: Validate dividends data

**Files:** modify `dividends.js`, `dividends.test.js`

**Test first:**
```js
import { validateDividendsData } from './dividends.js';

test('validateDividendsData requires shape and at least one dividend', () => {
  const good = { generated: '2026-10-28T10:00:00Z', window: { from: '2026-10-28', to: '2026-11-18' }, dividends: [{ symbol: 'KO', exDate: '2026-11-05' }] };
  assert.equal(validateDividendsData(good), true);
  assert.equal(validateDividendsData({ ...good, dividends: [] }), false);
  assert.equal(validateDividendsData(null), false);
  assert.equal(validateDividendsData({ ...good, window: {} }), false);
  assert.equal(validateDividendsData({ ...good, generated: 5 }), false);
  assert.equal(validateDividendsData({ ...good, dividends: [{ symbol: 'KO' }] }), false);
});
```

**Change:** export `validateDividendsData(d)`: object, `window.from`/`window.to` strings, `generated` string, `dividends` non-empty array, every item has string `symbol` and `exDate`.

**Verify:** `npm test` → 27 passed, 0 failed

**Commit:** `Validate dividends data`

### [x] Step 4: Paginated Polygon fetch with rate-limit spacing, retries, page cap

**Files:** create `fetch-dividends.js`, create `fetch-dividends.test.js`

**Test first:**
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllPages } from './fetch-dividends.js';

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
```

**Change:** `fetch-dividends.js` exports `fetchAllPages(url, { token, fetchImpl = fetch, sleep = defaultSleep, maxPages = 40 })`. Constants `PAGE_GAP_MS = 13000`, `RETRY_WAIT_MS = 60000`, `ATTEMPTS = 3`, `REQUEST_TIMEOUT_MS = 30000`; module-level `export const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))` used as the `sleep` default. Each request is `fetchImpl(u + '&apiKey=' + token, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })` (a hung connection becomes a retryable network error). Per request: loop attempts; a thrown fetch, status 429, or status ≥ 500 is retryable (sleep `RETRY_WAIT_MS` unless last attempt); last failure throws `Polygon <status|network error> for <pathname>`; other non-OK throws immediately with the same message format. Body whose `results` isn't an array throws `Unexpected Polygon response shape for <pathname>`. Accumulate `results`; follow `next_url`; sleep `PAGE_GAP_MS` before each next page; if the page count would exceed `maxPages`, throw `Polygon page cap (<maxPages>) hit for <pathname>`. Error messages use `new URL(u).pathname` only.

**Verify:** `npm test` → 30 passed, 0 failed

**Commit:** `Fetch paginated Polygon results with spacing, retries and a page cap`

### [x] Step 5: fetchDividends end to end (token check, ticker floor, validation)

**Files:** modify `fetch-dividends.js`, `fetch-dividends.test.js`

**Test first:**
```js
import { fetchDividends } from './fetch-dividends.js';

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
  assert.match(seen[0], /\/v3\/reference\/dividends\?ex_dividend_date\.gte=2026-10-28&ex_dividend_date\.lte=2026-11-18&limit=1000&apiKey=K$/);
  assert.match(seen[1], /\/v3\/reference\/tickers\?market=stocks&active=true&limit=1000&apiKey=K$/);
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
```

**Change:** export `fetchDividends({ token, fetchImpl = fetch, now = todayET(), sleep = defaultSleep })` (the default matters: the CLI passes no `sleep`): throw `'POLYGON_API_KEY is not set'` if no token; `DAYS = 21`, `MIN_TICKERS = 8000`; fetch `https://api.polygon.io/v3/reference/dividends?ex_dividend_date.gte=<now>&ex_dividend_date.lte=<now+21>&limit=1000`, then (after `await sleep(PAGE_GAP_MS)`) `https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000`; `toTickerMap`; if `size < MIN_TICKERS` throw `Polygon ticker list too short (<n>)`; `toDividendsData(rows, map, WATCHLIST, now, DAYS)`; if `!validateDividendsData` throw `Produced dividends data failed validation`.

**Verify:** `npm test` → 32 passed, 0 failed

**Commit:** `Fetch whole-market dividends from Polygon`

### [x] Step 6: CLI entry and npm script

**Files:** modify `fetch-dividends.js`, `package.json`

**Test first:** (behavioral, run before and after the change)
```sh
POLYGON_API_KEY= node fetch-dividends.js; echo "exit=$?"; test -e dividends.json && echo EXISTS || echo ABSENT
```
Before: `exit=0`, `ABSENT` (module has no CLI yet — proves the check can fail).

**Change:** append CLI block mirroring `fetch-earnings.js`: `if (process.argv[1] === new URL(import.meta.url).pathname)` → `fetchDividends({ token: process.env.POLYGON_API_KEY })`, on success `writeFileSync(OUT, JSON.stringify(data) + '\n')` where `OUT = new URL('./dividends.json', import.meta.url)` and log `wrote <n> dividends for <from>..<to>`; on error `console.error('fetch-dividends failed:', err.message); process.exit(1)`. In `package.json` scripts add `"fetch:dividends": "node fetch-dividends.js"`.

**Verify:** same command → `fetch-dividends failed: POLYGON_API_KEY is not set`, `exit=1`, `ABSENT`; and `npm test` → 32 passed.

**Commit:** `Add fetch-dividends CLI and npm script`

### [x] Step 7: Workflow step, concurrency, commit both files; README

**Files:** modify `.github/workflows/earnings.yml`, `README.md`

**Test first:** `node -e "const y=require('fs').readFileSync('.github/workflows/earnings.yml','utf8');for(const s of ['concurrency','timeout-minutes','Fetch dividends','POLYGON_API_KEY','git diff --cached --quiet','dividends.json'])console.log(s, y.includes(s))"` → before: all six print `false`.

**Change:** workflow: top-level `concurrency: { group: earnings, cancel-in-progress: false }`; new step after "Fetch earnings": `name: Fetch dividends`, `if: ${{ !cancelled() }}`, `timeout-minutes: 12` (step-level, so a hang fails only this step and the commit step still runs — a job-level timeout would cancel the earnings commit too), `env: POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}`, `run: node fetch-dividends.js`; commit step gets `if: ${{ !cancelled() }}` and body:
```sh
git add earnings.json
if [ -f dividends.json ]; then git add dividends.json; fi
if ! git diff --cached --quiet; then
  git config user.name "earnings-bot"
  git config user.email "actions@github.com"
  git commit -m "Update data ($(date -u +%Y-%m-%d))"
  git push
else
  echo "No change."
fi
```
README: "Dividends" section — source Polygon free tier, `POLYGON_API_KEY` secret setup steps, `npm run fetch:dividends`, coverage note (announced-so-far, US-listed USD only, OTC excluded), failure behavior.

**Verify:** the same node check → all 6 `true`; then simulate the commit body in a throwaway repo (scratch dir, not this repo): init, commit an `earnings.json`, then run the step body with `git push` replaced by `echo PUSH` for three cases — (a) only earnings changed, no dividends.json → commit contains only earnings.json; (b) new untracked dividends.json → commit contains it (`git show --stat HEAD`); (c) nothing changed → prints `No change.`; `python3 -c "import yaml,sys;yaml.safe_load(open('.github/workflows/earnings.yml'))" && echo YAML_OK` → `YAML_OK`; `npm test` → 32 passed.

**Commit:** `Run dividends fetch in the daily workflow and document setup`

### [x] Step 8: Live run and initial dividends.json

**Files:** create `dividends.json` (generated)

**Test first:** `test -e dividends.json && echo EXISTS || echo ABSENT` → `ABSENT`.

**Change:** `POLYGON_API_KEY=<user key> npm run fetch:dividends` (≈3.5 min).

**Verify:** prints `wrote <n> dividends for <today>..<today+21>`. Expected n ≈ 700 (design evidence on 2026-10-28: 644 direct matches + ~65 preferreds); accept 500–1000, investigate outside. Then:
```sh
node -e "const d=require('./dividends.json');const L=d.dividends,s=new Set(L.map(x=>x.symbol));const keys=L.map(x=>[x.symbol,x.exDate,x.amount,x.special].join('|'));
console.log('n',L.length,'inWindow',L.every(x=>x.exDate>=d.window.from&&x.exDate<=d.window.to),'dupFree',new Set(keys).size===keys.length,
'allListed',L.every(x=>x.exchange&&x.type),'types',[...new Set(L.map(x=>x.type))].sort().join(','),'watch',L.filter(x=>x.watch).length,
'spot',['PFE','O','COST','TXN'].map(t=>t+':'+s.has(t)).join(' '))"
```
→ `inWindow true`, `dupFree true`, `allListed true`, types include `CS`, `ETF`, `PFD`, `watch` ≥ 1. Spot tickers had in-window ex-dates on 2026-10-28; if run on a later date, a `false` there needs a per-ticker Polygon check, not an automatic fail. Key leak: `grep -rn "$(echo $POLYGON_API_KEY | cut -c1-8)" --exclude-dir=.git . ; echo "exit=$?"` → `exit=1` (no matches, tracked or untracked).

**Commit:** `Add initial dividends.json`

## Merge-order note
The workflow change (Step 7) runs the dividends step on the first scheduled run after merge.
The `POLYGON_API_KEY` repo secret must be added **before** merging the PR, or the dividends
step fails red daily (earnings still commit). The PR description repeats this.

## Plan critique
Tier: typical. Models: Dependency Auditor → sonnet, Verifiability → sonnet, Rollback → sonnet.

1. [med] `fetchDividends` had no `sleep` default; CLI passes none → TypeError on first live
   run (Dependency). **Resolved:** shared `defaultSleep` default.
2. [low→fixed] Assertions inside stub `fetchImpl` would be swallowed by retry logic
   (Dependency). **Resolved:** stub records URLs; asserts after.
3. [high] Job-level `timeout-minutes` would cancel the earnings commit too (Rollback).
   **Resolved:** step-level `timeout-minutes: 12` on dividends only; plus 30 s per-request
   `AbortSignal.timeout`, so no request can hang indefinitely (tested via signal presence).
4. [med] Step 7 verify only string-matched the YAML (Verifiability). **Resolved:** commit
   body simulated in a scratch repo for 3 cases.
5. [med] Step 8 checks were weak (made-up range, literal `true`) (Verifiability,
   Dependency). **Resolved:** range from measured evidence; checks window, dupes,
   listed-ness, PFD present (preferred mapping), watch overlay; key-leak grep covers
   untracked files.
6. [med] Workflow merges before secret exists (Rollback). **Resolved:** merge-order note,
   repeated in PR.
7. [low] `2>/dev/null ||` fallback hid git errors (Rollback). **Resolved:** explicit
   `[ -f dividends.json ]`.
Declined: separate workflow file for isolation (Rollback #1) — one job + concurrency
group avoids two bots racing pushes; earnings isolation comes from `!cancelled()` and the
step-level timeout. Rollback path: revert the PR's workflow commit. Step 6 success-path
CLI coverage comes from Step 8's live run (CLI guard mirrors fetch-earnings.js, which
runs in this repo and in CI).
