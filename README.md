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

## Dividends

The same Action also writes `dividends.json`: every US exchange-listed stock, ETF and
preferred (NYSE, Nasdaq, NYSE Arca, Cboe, NYSE American) with an ex-dividend date from
30 days ago through 30 days ahead. Past rows have already gone ex; future rows show up
once declared, so later days are sparser (most are announced 2–4 weeks ahead). USD only; OTC and foreign lines are left out.

Source is **Polygon.io's free tier** (Nasdaq's dividend calendar only covers
Nasdaq-listed securities). One-time setup:

1. Create a free account at https://polygon.io and copy your API key.
2. Repo → Settings → Secrets and variables → Actions → New repository secret →
   name `POLYGON_API_KEY`, value = the key.

A run takes about 7 minutes (the free tier allows 5 requests/minute). If it fails,
`dividends.json` keeps its last-good contents, earnings still update, and the run
shows red.

## Develop
- `npm test` — unit tests for the transform and both source adapters.
- `npm run fetch` — fetch live data locally (keyless Nasdaq by default).
- `EARNINGS_SOURCE=finnhub FINNHUB_API_KEY=xxx npm run fetch` — via Finnhub.
- `POLYGON_API_KEY=xxx npm run fetch:dividends` — fetch dividends locally.

Edit the watched companies in `watchlist.js`.
