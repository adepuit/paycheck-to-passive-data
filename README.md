# paycheck-to-passive-data

Public data pipeline for the Paycheck to Passive **Earnings Hub** tool.

A scheduled GitHub Action fetches upcoming earnings for the companies in
`watchlist.js` and commits `earnings.json`, which the Earnings Hub tool fetches
at load via raw.githubusercontent.

## Data source

Default is **Nasdaq's keyless earnings calendar** — no account, no API key, no
setup. The daily Action just runs. If Nasdaq ever gets unreliable, switch to
**Finnhub** without any code changes:

1. Create a free Finnhub API key at https://finnhub.io.
2. Repo → Settings → Secrets and variables → Actions → add `FINNHUB_API_KEY`.
3. In `.github/workflows/earnings.yml`, set `EARNINGS_SOURCE: finnhub`.

If the fetch fails, the pipeline keeps the last-good `earnings.json` (it never
overwrites with junk), and if the data goes stale the tool shows badged sample
data instead of anything wrong.

## Develop
- `npm test` — unit tests for the transform and both source adapters.
- `npm run fetch` — fetch live data locally (keyless Nasdaq by default).
- `EARNINGS_SOURCE=finnhub FINNHUB_API_KEY=xxx npm run fetch` — via Finnhub.

Edit the watched companies in `watchlist.js`.
