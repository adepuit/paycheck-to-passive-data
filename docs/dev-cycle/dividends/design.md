# Design: Dividend data

## Goal
Alongside `earnings.json`, the daily pipeline publishes `dividends.json`: every US
exchange-listed security — NYSE, Nasdaq, NYSE Arca, Cboe BZX, NYSE American; single
stocks **and ETFs** (e.g. KO, XOM, SCHD, VYM, DGRO, SPY, JEPI) — with an **announced**
ex-dividend date from **today through 21 days ahead** (no look-back), watchlist
companies flagged. Dividends appear once declared, so later days in the window are
sparser than near ones ("announced so far", not a forecast). `earnings.json` and its
pipeline are unchanged.

## Approach
**Chosen: Polygon.io (now Massive) free tier**, with a `POLYGON_API_KEY` secret.

Why not Nasdaq (the earnings source): its dividend calendar covers **Nasdaq-listed
securities only** — verified 2026-10-28: no KO/XOM/JNJ/PG/SCHD/VYM/DGRO/SPY across
3 weeks of Sept + Oct/Nov days; its per-symbol endpoint returns "Dividend History for
Non-Nasdaq symbols is not available". User requires all exchanges incl. ETFs.
Alternatives considered: FMP free key (calendar endpoint on free plan unconfirmed);
keyless Yahoo per-ticker for a curated list (not whole market, unofficial, fragile).
User chose Polygon.

Verified live 2026-10-28 with the user's free key:
- `GET /v3/reference/dividends?ex_dividend_date.gte=<today>&ex_dividend_date.lte=<+21>&limit=1000`
  → 1,223 rows in 2 pages (`next_url` pagination). Fields: `ticker, cash_amount,
  currency, declaration_date (missing on 273), ex_dividend_date, pay_date, record_date,
  frequency (0/1/2/4/12), dividend_type (CD regular, SC special)`. Includes NYSE (PFE, O)
  and Nasdaq (COST, TXN). Per-ticker history shows SCHD 9/23, VYM 9/18, DGRO 9/15, and KO
  already has 12/01 declared. Includes non-US OTC lines in CAD/GBP/JPY/… (~20%).
- `GET /v3/reference/tickers?market=stocks&active=true&limit=1000` → exchange-listed
  US tickers with `name, primary_exchange, type`. Measured: **14 pages, 13,254 tickers,
  175 s** at 13 s spacing; XNAS 5,613 / XNYS 2,886 / ARCX 2,746 / BATS 1,677 / XASE 310;
  ETF 5,549, CS 5,320. SCHD, VYM, DGRO, SPY, VOO, JEPI present as ARCX/ETF; KO, XOM
  as XNYS/CS; QQQ as XNAS/ETF. No OTC tickers.
- Joining: 968 USD dividend rows in the window, 644 match a listed ticker as-is. Listed
  preferreds use a different format in the two endpoints (dividends `SCHWPRJ`, tickers
  `SCHWpJ`) — ~65 rows recovered by mapping `<root>PR<X>` → `<root>p<X>`. The rest are
  OTC/foreign ADR lines (e.g. JUMSY, DUNIY), intentionally dropped.
- Free tier: 5 requests/minute (documented; our 13 s spacing ran 16 requests clean).

## Components & boundaries
**`dividends.js`** (pure, no I/O)
- `toTickerMap(tickerRows) -> Map<symbol, {name, exchange, type}>`.
- `toDividendsData(divRows, tickerMap, watchlist, todayISO, days) -> data` — keeps rows
  with `ex_dividend_date` in `[today, today+days]`, `currency === 'USD'`, and ticker in
  the listed-ticker map (drops OTC/foreign lines), trying the preferred-share mapping
  above when a direct match fails. Output symbols use the ticker-map form, with
  class-share dots turned into dashes (`BRK.B` → `BRK-B`, matching `watchlist.js`). Overlays watchlist name /
  domain / logo / `watch`. Removes exact duplicates (same symbol|exDate|amount) only;
  regular + special on one day are both kept. Sorts by exDate, then symbol.
- `validateDividendsData(d) -> bool` — shape check and `dividends.length > 0`.
  (A count-vs-previous rule was considered and dropped — see red-team pass 2 #4.)

Output shape (missing values `null`):
```json
{ "generated": "ISO", "window": {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}, "sample": false,
  "dividends": [{ "symbol","name","domain","logo","watch","type","exchange",
                  "exDate","payDate","recordDate","declaredDate",
                  "amount","frequency","special" }] }
```
`type` lets the tool filter stocks vs ETFs; `special` flags one-off dividends.

**`fetch-dividends.js`** — `fetchDividends({ token, fetchImpl, now, sleep })`:
1. Throws immediately if `token` missing. `now` defaults to `todayET()` (same as
   earnings), so "today" is the US-market date regardless of runner timezone.
2. `fetchAllPages(url)`: follows `next_url` (appending `apiKey`), waits 13 s between
   requests (≤5/min). Each request: up to 3 attempts on HTTP 429, 5xx, or network
   error, waiting 60 s between attempts; other non-OK or unexpected shape (`results`
   not an array) throws. **Hitting the 40-page cap throws** (never returns a
   truncated list).
3. Fetches dividends window, then tickers. **Throws if the ticker map has < 8,000
   entries** (measured 13,254) — a short ticker list would silently drop real dividends.
   Transforms; validates; returns data.
`sleep` is injectable so tests don't wait. CLI writes
compact JSON; on any error: message to stderr, exit 1, file untouched. The key is
never logged (error messages print URL path only, not query).

**Workflow** (`.github/workflows/earnings.yml`): new "Fetch dividends" step after
earnings, `if: ${{ !cancelled() }}`, env `POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}`.
Add `concurrency: { group: earnings, cancel-in-progress: false }` so a manual run and
the cron never push at once, and `timeout-minutes: 12` on the dividends **step** (a job-level
timeout would cancel the commit step and lose earnings; changed during planning).
Commit step also `if: ${{ !cancelled() }}`: `git add earnings.json dividends.json`, commit
only if `git diff --cached --quiet` reports changes (plain `git diff --quiet` ignores a
new untracked file — verified). Failing step still marks the job red.

**`package.json`**: `"fetch:dividends": "node fetch-dividends.js"`. **README**: Dividends
section incl. secret setup.

## Data flow
cron → fetch-earnings (unchanged) → fetch-dividends: Polygon dividends (≈2 pages) +
tickers (14 pages), ~3.5 min at the rate limit → filter/overlay/sort → validate
→ write → `git add` both, commit if staged changes → tool fetches via
raw.githubusercontent.

## Error handling
- Missing secret, HTTP error after 3 attempts, bad shape, page cap hit, short ticker
  map, or empty result → step fails, last-good `dividends.json` kept, earnings still
  committed, job red (GitHub emails the workflow owner on scheduled-run failure). The
  file's `generated` timestamp lets the consuming tool detect staleness the same way it
  does for earnings (`isStale`); wiring that into the tool is out of scope here.
- No partial-file publishing: one range query replaces the per-day loop, so there are
  no "missing days" to patch.
- Row with no ticker or bad ex-date → dropped; other missing fields → `null`.

## Testing strategy
`node --test`: `dividends.test.js` (window filter incl. no past rows, USD/listed filter,
dot→dash, PR→p preferred mapping, watchlist overlay, dedupe keeps special+regular, sort,
validation incl. empty) and `fetch-dividends.test.js` with stubbed `fetchImpl` + `sleep`
(pagination via next_url, 429/5xx retry up to 3, page-cap throws, short ticker map
throws, non-OK throws, missing token throws, key not in error text). Plus one live `npm run fetch:dividends` checking total count and that KO/
SCHD-type rows carry exchange/type.

## Out of scope
- Look-back / paid-dividend history; yield; growth; forecasting undeclared dividends.
- Earnings source changes; Earnings Hub UI.
- OTC / foreign-currency lines.

## Red-team findings — pass 2 (Polygon redesign)
Tier: typical. Re-gated because the source change was structural.
Models: Skeptic → sonnet, Simplifier → sonnet, Edge-Case Hunter → sonnet, Premortem → opus; evidence checks run directly by main session (live API calls needed the user's key, which subagents did not get).

1. [high] Truncated/short ticker list silently drops dividends; page count unmeasured;
   page-cap behavior unstated (Skeptic, Edge-Case, Premortem). **Verified:** 14 pages,
   13,254 tickers. **Resolved:** cap hit throws; ticker map < 8,000 throws.
2. [med] ETFs might be absent from `/v3/reference/tickers?market=stocks` (Skeptic).
   **Refuted:** SCHD/VYM/DGRO/SPY/VOO/JEPI present as ARCX/ETF.
3. [high] One transient 429/5xx fails the run (Edge-Case, Skeptic). **Resolved:** 3
   attempts per request, 60 s apart; step `timeout-minutes: 12`.
4. [med] 25%-of-previous rule: Simplifier says delete; Edge-Case says it can wedge stale
   data in a sparse week. Both point the same way. **Resolved:** dropped; the real
   partial-data risk (short ticker map) now has its own check.
5. [med] Overlapping manual + cron runs → push fails (Edge-Case). **Resolved:**
   workflow `concurrency` group.
6. [med] "Today" timezone unstated (Edge-Case). **Resolved:** `todayET()`.
7. [high] Vendor risk: single free-tier source mid-rebrand, no fallback; stale file kept
   forever (Premortem). **Partially resolved:** failure is loud (red job + GitHub email),
   `generated` allows staleness detection. **Accepted risk:** no second source (Nasdaq
   can't cover NYSE/Arca, so a fallback would be Nasdaq-only). Surfaced to user.
Found during evidence checks: listed preferreds use `PR<X>` vs `p<X>` across endpoints
— resolved with a mapping.
Dropped/declined: Simplifier's removing `type`/`special`/`frequency`/`recordDate` —
`type` is what lets the tool separate stocks from ETFs (user's explicit ask); the others
cost one line each. Injectable `sleep` kept (tests need it).
