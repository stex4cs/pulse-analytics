'use client';

/**
 * Choropleth mapa + mehurići gradova.
 *
 * Mapa je ugrađena (SVG putanje u lib/world-map.js), ne učitava se sa tuđeg
 * servera — CSP dashboarda je `default-src 'self'`, a i ne želimo da posetioci
 * dashboarda odlaze trećoj strani po pločice.
 *
 * Skala je KVANTILNA, ne linearna. Za srpski portal je ~60% saobraćaja jedna
 * država; linearna skala bi obojila Srbiju tamno a sve ostalo praktično bez
 * boje, pa se dijaspora — koja je zapravo zanimljiva — ne bi videla. Legenda
 * ispisuje stvarne granice klasa da skala ne bi obmanula.
 */

import { useMemo, useState } from 'react';
import {
  WORLD_VIEWBOX, EUROPE_VIEWBOX, COUNTRY_PATHS, COUNTRY_NAMES, projectLatLon,
} from '@/lib/world-map';
import { num, compact } from '@/lib/format';

const RAMP = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];

/** Kvantilne granice: svaka klasa nosi približno isti broj država. */
function quantileBreaks(values, classes) {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const breaks = [];
  for (let i = 1; i < classes; i++) {
    breaks.push(sorted[Math.floor((i / classes) * sorted.length)]);
  }
  return breaks;
}

function classOf(value, breaks) {
  if (!value) return -1;
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

export function GeoMap({ countries, cities = [], onSelectCountry, selectedCountry }) {
  const [scope, setScope] = useState('europe');
  const [hover, setHover] = useState(null);

  const byCountry = useMemo(
    () => new Map(countries.map((c) => [c.country, c])),
    [countries],
  );

  const breaks = useMemo(
    () => quantileBreaks(countries.map((c) => c.pageviews), RAMP.length),
    [countries],
  );

  const maxCity = useMemo(
    () => cities.reduce((m, c) => Math.max(m, c.pageviews), 0),
    [cities],
  );

  const viewBox = scope === 'europe' ? EUROPE_VIEWBOX : WORLD_VIEWBOX;
  const vb = viewBox.split(' ').map(Number);

  // Mehurići se skaliraju po korenu površine, ne po prečniku — inače najveći
  // grad vizuelno pojede sve ostale.
  const radiusFor = (pv) => {
    if (!maxCity) return 0;
    const scale = scope === 'europe' ? 5.5 : 12;
    return Math.max(0.6, Math.sqrt(pv / maxCity) * scale);
  };

  const visibleCities = cities
    .filter((c) => c.lat || c.lon)
    .map((c) => ({ ...c, ...projectLatLon(c.lat, c.lon) }))
    .filter((c) => c.x >= vb[0] && c.x <= vb[0] + vb[2] && c.y >= vb[1] && c.y <= vb[1] + vb[3])
    .sort((a, b) => b.pageviews - a.pageviews);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {[['europe', 'Evropa'], ['world', 'Svet']].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${scope === value
                ? 'bg-[var(--series-1)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {selectedCountry && (
          <button
            type="button"
            onClick={() => onSelectCountry?.(null)}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          >
            {COUNTRY_NAMES[selectedCountry] ?? selectedCountry} ✕
          </button>
        )}
        <span className="ml-auto text-xs text-[var(--text-muted)]">
          Klik na državu filtrira gradove ispod
        </span>
      </div>

      <div className="relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)]">
        <svg viewBox={viewBox} className="block h-auto w-full" role="img"
          aria-label="Mapa poseta po državama i gradovima">
          <g>
            {Object.entries(COUNTRY_PATHS).map(([code, d]) => {
              const row = byCountry.get(code);
              const cls = classOf(row?.pageviews ?? 0, breaks);
              const isSelected = selectedCountry === code;
              return (
                <path
                  key={code}
                  d={d}
                  fill={cls >= 0 ? RAMP[Math.min(cls, RAMP.length - 1)] : 'var(--surface-1)'}
                  stroke={isSelected ? 'var(--series-2)' : 'var(--border)'}
                  strokeWidth={isSelected ? 1.2 : 0.3}
                  className={row ? 'cursor-pointer' : ''}
                  onMouseEnter={() => row && setHover({
                    label: COUNTRY_NAMES[code] ?? code,
                    value: row.pageviews,
                    sub: `${row.share}% · ${num(row.uniqueVisitors)} jedinstvenih`,
                  })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => row && onSelectCountry?.(isSelected ? null : code)}
                />
              );
            })}
          </g>

          <g>
            {visibleCities.map((c) => (
              <circle
                key={`${c.country}-${c.city}`}
                cx={c.x}
                cy={c.y}
                r={radiusFor(c.pageviews)}
                fill="var(--series-2)"
                fillOpacity={0.55}
                stroke="var(--surface-1)"
                strokeWidth={0.25}
                className="cursor-pointer"
                onMouseEnter={() => setHover({
                  label: `${c.city}, ${c.country}`,
                  value: c.pageviews,
                  sub: `${num(c.uniqueVisitors)} jedinstvenih`,
                })}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>

        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 shadow-lg">
            <div className="text-xs font-medium text-[var(--text-primary)]">{hover.label}</div>
            <div className="tabular text-sm font-semibold text-[var(--text-primary)]">
              {num(hover.value)} <span className="text-xs font-normal text-[var(--text-muted)]">pregleda</span>
            </div>
            {hover.sub && <div className="text-xs text-[var(--text-muted)]">{hover.sub}</div>}
          </div>
        )}
      </div>

      {/* Legenda sa stvarnim granicama klasa — bez toga kvantilna skala obmanjuje */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <span>Pregledi:</span>
          <span className="flex overflow-hidden rounded">
            {RAMP.map((c) => <span key={c} className="h-2.5 w-8" style={{ background: c }} />)}
          </span>
          <span className="tabular">
            {breaks.length
              ? `< ${compact(breaks[0])} … ≥ ${compact(breaks[breaks.length - 1])}`
              : '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--series-2)', opacity: 0.55 }} />
          <span>Gradovi (površina kruga ∝ pregledima)</span>
        </div>
        <span className="ml-auto">
          Skala je kvantilna — svaka nijansa nosi približno isti broj država.
        </span>
      </div>
    </div>
  );
}
