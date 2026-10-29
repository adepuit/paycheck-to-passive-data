# Review: Dividend data

## Pass 1 — 2026-10-28
- Tier: typical, full 4-lens
- Models: Correctness → sonnet, Simplicity → sonnet, Test Quality → sonnet, Feature Reviewer → sonnet
- Diff reviewed: abcc302..6026ceb (excluding generated dividends.json and docs)

| Confidence | Finding | Routing | Resolution |
|---|---|---|---|
| med | CLI block (argv guard, write, exit 1 without overwrite) has no automated test | user follow-up | Covered by live run + missing-key run in verification.md; mirrors fetch-earnings.js CLI. Recommend leave. |
| med | Tests: preferred mapping not exercised end-to-end via toDividendsData; KO watchlist test depends on real watchlist.js; some asserts check exact sleep/URL shape | user follow-up | Recommend leave; mutation check showed mapping test fails when mapping breaks. |
| med | Design says job `timeout-minutes: 20`; workflow has step-level 12 (Feature Reviewer) | doc drift | Intentional plan change (job timeout would cancel commit step). design.md updated. |
| low | `res.json()` outside retry: truncated 200 body fails the run without retrying | user follow-up | Next day's run retries; recommend fix only if seen in practice. |
| low | Dedupe key omits payDate/frequency; could merge two identical-amount distributions on one day | user follow-up | Matches design (exact duplicates only). Leave. |
| low | 4 rows have `exchange: null` (ET, ETpI, SUN, SUNC); AIPI `frequency: 52` (weekly) | accepted | Source data, passed through per design. |
| low | Simplicity: window computed twice; exported `defaultSleep`; banner comments | declined | Cosmetic. |

Pass ends cycle: zero high-confidence findings.
