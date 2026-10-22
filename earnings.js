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

function numOrNull(v) {
  return (typeof v === 'number' && isFinite(v)) ? v : null;
}

// Trim noisy exchange/security suffixes from raw provider names.
export function cleanName(n) {
  return String(n || '')
    .replace(/\s*(Class\s+[A-Z]\s+)?(Common Stock|Common Shares|Ordinary Shares|American Depositary Shares|Depositary Shares|Depositary Units)$/i, '')
    .trim();
}

// By date, then market cap (biggest first) within a day.
function byDateThenCap(a, b) {
  return a.date < b.date ? -1 : a.date > b.date ? 1
    : ((b.marketCap || 0) - (a.marketCap || 0)) || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
}

// Whole US market: keep every company in the window (pastDays back to days ahead). Overlay
// the watchlist for clean names, logos/domains, and a `watch` flag (so the tool can offer a
// "My list" view). Past days carry the reported EPS and % surprise.
export function toEarningsData(response, watchlist, todayISO, days, pastDays = 0) {
  const from = addDaysISO(todayISO, -pastDays);
  const to = addDaysISO(todayISO, days);
  const wl = new Map(watchlist.map((w) => [w.symbol, w]));
  const raw = (response && response.earningsCalendar) || [];
  const events = raw
    .filter((e) => e && e.symbol && e.date >= from && e.date <= to)
    .map((e) => {
      const w = wl.get(e.symbol);
      return {
        symbol: e.symbol,
        name: w ? w.name : (cleanName(e.name) || e.symbol),
        domain: (w && w.domain) || null,
        logo: (w && w.logo) || null,
        watch: !!w,
        date: e.date,
        hour: normalizeHour(e.hour),
        epsEstimate: numOrNull(e.epsEstimate),
        marketCap: numOrNull(e.marketCap),
        numEstimates: numOrNull(e.numEstimates),
        lastYearEps: numOrNull(e.lastYearEps),
        fiscalQuarter: (typeof e.fiscalQuarter === 'string' && e.fiscalQuarter) ? e.fiscalQuarter : null,
        eps: numOrNull(e.eps),
        surprise: numOrNull(e.surprise),
      };
    })
    .sort(byDateThenCap);
  return { generated: new Date().toISOString(), window: { from, to }, sample: false, events };
}

// Fills gaps from the previous file: once a day has passed, the provider drops its
// before-open/after-close time and some estimates, so those carry over. Days that failed
// to fetch (missingDays) keep the previous file's companies.
export function mergePrevious(data, previous, missingDays = []) {
  if (!validateEarningsData(previous)) return data;
  const prev = new Map(previous.events.map((e) => [e.date + '|' + e.symbol, e]));
  const events = data.events.map((e) => {
    const p = prev.get(e.date + '|' + e.symbol);
    if (!p) return e;
    const out = { ...e };
    for (const k of Object.keys(p)) {
      if (out[k] == null || (k === 'hour' && out.hour === 'unknown')) out[k] = p[k];
    }
    return out;
  });
  const missing = new Set(missingDays);
  for (const e of previous.events) {
    if (missing.has(e.date) && e.date >= data.window.from && e.date <= data.window.to) events.push(e);
  }
  return { ...data, events: events.sort(byDateThenCap) };
}

// Monday (as YYYY-MM-DD) of the ISO date's week. UTC-noon parse avoids TZ drift.
export function mondayOf(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// n consecutive ISO days starting at mondayIso (default Mon-Fri).
export function weekDays(mondayIso, n = 5) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDaysISO(mondayIso, i));
  return out;
}

export function formatDayLabel(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(d);
  const monthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
  return { weekday, monthDay };
}
