'use client';

import { useState } from 'react';
import { num, pct, trendClass, trendArrow } from '@/lib/format';

export function Card({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-lg border border-[var(--border)] bg-[var(--surface-1)] ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Jedan broj koji nosi poentu. Bez grafikona - kad je odgovor jedan broj,
 * grafik samo smeta.
 */
export function StatTile({ label, value, unit, trend, hint }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tabular text-2xl font-semibold text-[var(--text-primary)]">{value}</span>
        {unit && <span className="text-sm text-[var(--text-secondary)]">{unit}</span>}
        {trend !== undefined && trend !== null && (
          <span className={`tabular text-xs font-medium ${trendClass(trend)}`}>
            {trendArrow(trend)} {pct(Math.abs(trend))}
          </span>
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-[var(--surface-2)] text-[var(--text-secondary)]',
    good: 'bg-[var(--status-good)]/15 text-[var(--status-good)]',
    warning: 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]',
    critical: 'bg-[var(--status-critical)]/15 text-[var(--status-critical)]',
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Tabela sa sortiranjem po kolonama. Uvek prisutna uz grafike - tabelarni
 * prikaz je i pristupacnost i olaksica kad boja nije dovoljna.
 */
export function DataTable({ columns, rows, initialSort, onRowClick, empty = 'Nema podataka za izabrani period.' }) {
  const [sort, setSort] = useState(initialSort ?? { key: columns[1]?.key, dir: 'desc' });

  const sorted = [...rows].sort((a, b) => {
    const va = a[sort.key];
    const vb = b[sort.key];
    if (va === vb) return 0;
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : Number(va) - Number(vb);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const toggle = (key) => setSort((s) => ({
    key,
    dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc',
  }));

  if (!rows.length) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">{empty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                onClick={() => c.sortable !== false && toggle(c.key)}
                className={`border-b border-[var(--border)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]
                  ${c.align === 'right' ? 'text-right' : 'text-left'}
                  ${c.sortable !== false ? 'cursor-pointer select-none hover:text-[var(--text-primary)]' : ''}`}
              >
                {c.label}
                {sort.key === c.key && <span className="ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={row.id ?? i}
              onClick={() => onRowClick?.(row)}
              className={`border-b border-[var(--border)] last:border-0
                ${onRowClick ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${c.align === 'right' ? 'tabular text-right' : ''} text-[var(--text-primary)]`}
                >
                  {c.render ? c.render(row) : (typeof row[c.key] === 'number' ? num(row[c.key]) : row[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RangePicker({ value, onChange }) {
  const options = [
    { days: 1, label: 'Danas' },
    { days: 7, label: '7 dana' },
    { days: 30, label: '30 dana' },
    { days: 90, label: '90 dana' },
  ];
  return (
    <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
      {options.map((o) => (
        <button
          key={o.days}
          type="button"
          onClick={() => onChange(o.days)}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
            ${value === o.days
            ? 'bg-[var(--series-1)] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Button({ children, onClick, variant = 'secondary', type = 'button', disabled }) {
  const styles = {
    primary: 'bg-[var(--series-1)] text-white hover:opacity-90',
    secondary: 'border border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-primary)] hover:bg-[var(--surface-2)]',
    danger: 'border border-[var(--status-critical)] text-[var(--status-critical)] hover:bg-[var(--status-critical)]/10',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

export function Loading({ label = 'Učitavanje…' }) {
  return <p className="py-10 text-center text-sm text-[var(--text-muted)]">{label}</p>;
}

export function ErrorNote({ error }) {
  return (
    <div className="rounded-md border border-[var(--status-critical)]/40 bg-[var(--status-critical)]/10 px-4 py-3 text-sm text-[var(--status-critical)]">
      {error?.message ?? String(error)}
    </div>
  );
}

/** Napomena uz podatak koji se lako pogresno protumaci. */
export function Note({ children }) {
  return (
    <p className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
      {children}
    </p>
  );
}
