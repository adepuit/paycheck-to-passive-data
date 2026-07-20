export function todayET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function normalizeHour(hour) {
  return (hour === 'bmo' || hour === 'amc' || hour === 'dmh') ? hour : 'unknown';
}

export function validateEarningsData(d) {
  if (!d || typeof d !== 'object') return false;
  if (!d.window || typeof d.window.from !== 'string' || typeof d.window.to !== 'string') return false;
  if (typeof d.generated !== 'string') return false;
  if (!Array.isArray(d.events)) return false;
  return d.events.every((e) => e && typeof e.symbol === 'string' && typeof e.date === 'string');
}

export function isStale(data, todayISO, maxAgeDays = 3) {
  if (!data || !data.window || typeof data.window.to !== 'string') return true;
  if (data.window.to < todayISO) return true;
  const gen = Date.parse(data.generated);
  if (!isFinite(gen)) return true;
  return (Date.now() - gen) > maxAgeDays * 86400000;
}

export function groupByDay(events) {
  const byDate = new Map();
  for (const e of (events || [])) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.keys()].sort().map((date) => ({ date, items: byDate.get(date) }));
}

export function toEarningsData(finnhubResponse, watchlist, todayISO, days) {
  const from = todayISO;
  const to = addDaysISO(todayISO, days);
  const names = new Map(watchlist.map((w) => [w.symbol, w.name]));
  const raw = (finnhubResponse && finnhubResponse.earningsCalendar) || [];
  const events = raw
    .filter((e) => e && names.has(e.symbol) && e.date >= from && e.date <= to)
    .map((e) => ({
      symbol: e.symbol,
      name: names.get(e.symbol),
      date: e.date,
      hour: normalizeHour(e.hour),
      epsEstimate: (typeof e.epsEstimate === 'number') ? e.epsEstimate : null,
      quarter: (typeof e.quarter === 'number') ? e.quarter : null,
      year: (typeof e.year === 'number') ? e.year : null,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0)));
  return { generated: new Date().toISOString(), window: { from, to }, sample: false, events };
}

export function formatDayLabel(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
  return { weekday, monthDay };
}
