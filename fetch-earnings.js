import { writeFileSync } from 'node:fs';
import { WATCHLIST } from './watchlist.js';
import { todayET, addDaysISO, toEarningsData, validateEarningsData } from './earnings.js';

const DAYS = 21;
const OUT = new URL('./earnings.json', import.meta.url);

export async function fetchEarnings(token, fetchImpl = fetch, now = todayET()) {
  if (!token) throw new Error('FINNHUB_API_KEY is not set');
  const from = now;
  const to = addDaysISO(now, DAYS);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${token}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('Finnhub HTTP ' + res.status);
  const raw = await res.json();
  if (!raw || !Array.isArray(raw.earningsCalendar)) throw new Error('Unexpected Finnhub response shape');
  const data = toEarningsData(raw, WATCHLIST, now, DAYS);
  if (!validateEarningsData(data)) throw new Error('Produced data failed validation');
  return data;
}

// CLI entry: fetch and write, but never overwrite with junk (throws => non-zero exit, file untouched).
if (process.argv[1] === new URL(import.meta.url).pathname) {
  fetchEarnings(process.env.FINNHUB_API_KEY)
    .then((data) => {
      writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
      console.log(`Wrote ${data.events.length} events for ${data.window.from}..${data.window.to}`);
    })
    .catch((err) => { console.error('fetch-earnings failed:', err.message); process.exit(1); });
}
