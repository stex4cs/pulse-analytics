/** Formatiranje brojeva i vremena. Prikaz je Europe/Belgrade, podaci su UTC. */

const nf = new Intl.NumberFormat('sr-RS');
const TZ = 'Europe/Belgrade';

export const num = (v) => nf.format(Math.round(Number(v) || 0));

export function compact(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace('.0', '')}k`;
  return String(Math.round(n));
}

export const pct = (v, digits = 1) => `${(Number(v) || 0).toFixed(digits)}%`;

export function duration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}m ${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function dateLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('sr-RS', { day: '2-digit', month: '2-digit', timeZone: TZ });
}

export function dateTimeLabel(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('sr-RS', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ,
  });
}

/** UTC sat -> sat u beogradskoj zoni, za ose grafika. */
export function hourLabel(hourUtc) {
  const d = typeof hourUtc === 'number'
    ? new Date(Date.UTC(2000, 0, 1, hourUtc))
    : new Date(hourUtc);
  return d.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export const trendClass = (v) => (Number(v) > 0 ? 'text-[var(--status-good)]'
  : Number(v) < 0 ? 'text-[var(--status-critical)]' : 'text-[var(--text-muted)]');

export const trendArrow = (v) => (Number(v) > 0 ? '↑' : Number(v) < 0 ? '↓' : '→');
