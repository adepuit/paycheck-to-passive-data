# paycheck-to-passive-data

Public data pipeline for the Paycheck to Passive **Earnings Hub** tool.

A scheduled GitHub Action fetches upcoming earnings from Finnhub for the
companies in `watchlist.js` and commits `earnings.json`, which the Earnings Hub
tool fetches at load via raw.githubusercontent.

## Setup (one time)
1. Create a free Finnhub API key at https://finnhub.io.
2. Repo → Settings → Secrets and variables → Actions → add `FINNHUB_API_KEY`.
3. Actions tab → run the **earnings** workflow (it also runs daily 10:00 UTC).

`earnings.json` ships as `sample` data until the first live run.

## Develop
- `npm test` — unit tests for the data transform.
- `FINNHUB_API_KEY=xxx npm run fetch` — fetch live data locally.
