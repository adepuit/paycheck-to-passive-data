# Verification: Dividend data

## Pass 1 — 2026-10-28
Models: Acceptance Tester → sonnet

| Claim | Evidence |
|---|---|
| Full suite green | `npm test` → 32 tests, 32 pass, 0 fail |
| Live run produces whole-market forward window | `npm run -s fetch:dividends` → `wrote 708 dividends for 2026-10-28..2026-11-18`, 3m20s, exit 0 |
| Rows in window, no duplicates, stocks + ETFs + preferreds | Step 8 check → `inWindow true dupFree true`, types `ADRC,CS,ETF,ETS,FUND,PFD,SP,UNIT`, watch 12, PFE/O/COST/TXN present |
| All exchanges covered | Acceptance tester: XNYS 398, XNAS 227, ARCX 40, BATS 17, XASE 22 |
| Missing key fails loudly, file untouched | `env -u POLYGON_API_KEY node fetch-dividends.js` → `fetch-dividends failed: POLYGON_API_KEY is not set`, exit=1, `git status` clean |
| Bad key error does not leak key | Acceptance tester: `POLYGON_API_KEY=bogus` → `Polygon 401 for /v3/reference/dividends` |
| Key not in repo | `grep -rn <first 8 chars> --exclude-dir=.git --exclude-dir=node_modules .` → exit 1 (no matches) |
| Tests fail without the change | `git stash` was a no-op (file committed) so not counted; instead mutated preferred-mapping regex in `dividends.js` → `node --test dividends.test.js` 4 pass / 1 fail (resolveListed); restored → 32 pass |
| Black-box acceptance | 12 PASS, 2 FAIL (below), run repeatable (same 708 rows, new `generated`) |
| Acceptance FAIL: `exchange` null on ET, ETpI, SUN, SUNC | Polygon's ticker records omit `primary_exchange` for these listed securities. Design: missing values → `null`. Accepted; logged in state.md Deviations. |
| Acceptance FAIL: `logo` null on watchlist rows | `watchlist.js` header: `logo` is an optional override; no entry sets it. Correct pass-through. Not a defect. |
| SCHD/VYM/DGRO absent from current file | Not a coverage gap: tester checked Polygon directly — SCHD's next ex-date is not yet announced; KO's is 2026-12-01 (outside window). Per-ticker probes show these ETFs appear in Polygon dividends when declared. |
| Retry on 429/5xx, page cap, short-ticker-map throws | Unit tests only (`fetch-dividends.test.js`, stubbed fetch). **Limitation:** not exercised against the live API. |
| Workflow: dividends step, `!cancelled()`, commit step | Commit-step shell logic simulated in a scratch repo (3 cases pass). **Limitation:** the Actions run itself not exercised until merged with the secret set. |
| Earnings pipeline unchanged | `git diff abcc302 -- earnings.js fetch-earnings.js watchlist.js` empty; earnings tests in suite pass. |
