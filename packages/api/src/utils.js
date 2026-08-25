/** Zajednicki pomocnici za rute dashboard API-ja. */

/** Bezbedan raspon datuma iz query stringa; sve u UTC (sekcija 15.4). */
export function dateRange(query = {}) {
  const today = new Date();
  const toDefault = today.toISOString().slice(0, 10);

  const days = Math.min(400, Math.max(1, Number(query.days) || 7));
  const fromDefault = new Date(today.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  const from = isDate(query.from) ? query.from : fromDefault;
  const to = isDate(query.to) ? query.to : toDefault;

  return from <= to ? { from, to, days } : { from: to, to: from, days };
}

export function periodType(query = {}) {
  const p = String(query.period ?? 'day');
  return ['day', 'week', 'month'].includes(p) ? p : 'day';
}

export function limit(query = {}, fallback = 50, max = 500) {
  const n = Number(query.limit);
  // Nula i negativne vrednosti su besmislene: vracamo podrazumevani broj
  // redova, a ne tiho jedan red.
  if (!Number.isFinite(n) || n <= 0) return Math.min(max, fallback);
  return Math.min(max, Math.trunc(n));
}

export function offset(query = {}) {
  return Math.max(0, Number(query.offset) || 0);
}

/**
 * Sortiranje po beloj listi kolona - nikad ne ubacuj korisnicki string u SQL.
 */
export function orderBy(query, allowed, fallback) {
  const col = allowed.includes(query.sort) ? query.sort : fallback;
  const dir = String(query.dir ?? 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir} NULLS LAST`;
}

/** Redovi -> CSV (sekcija 10.7). */
export function toCsv(rows, columns) {
  if (!rows.length) return '';
  const cols = columns ?? Object.keys(rows[0]);
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => escape(r[c])).join(','))].join('\n');
}

/** Poredjenje sa prethodnim periodom -> trend strelica u UI-ju. */
export function trend(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return c > 0 ? 100 : 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

/** Prethodni period iste duzine (za trend). */
export function previousRange(from, to) {
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  const span = t.getTime() - f.getTime() + 86_400_000;
  return {
    from: new Date(f.getTime() - span).toISOString().slice(0, 10),
    to: new Date(t.getTime() - span).toISOString().slice(0, 10),
  };
}
