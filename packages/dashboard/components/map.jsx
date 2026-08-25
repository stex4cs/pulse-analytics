'use client';

/**
 * Mapa poseta.
 *
 * Podrazumevani prikaz je isti kao u Google Analytics-u: neutralno siva podloga
 * i plavi mehurići na gradovima, veličina po broju. Razlog nije podražavanje —
 * kad je 60% saobraćaja iz jedne zemlje, bojenje država (choropleth) tu jednu
 * oboji tamno a sve ostalo ostavi bez boje. Mehurići pokazuju i gradove unutar
 * te zemlje, što je ono što se zapravo gleda.
 *
 * Choropleth ostaje kao drugi režim jer je bolji za poređenje udela.
 *
 * Mapa je ugrađena (SVG putanje u lib/world-map.js) i ne poziva nijedan spoljni
 * servis — CSP je `default-src 'self'`, a i ne želimo da posetioci dashboarda
 * odlaze trećoj strani po pločice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WORLD_VIEWBOX, EUROPE_VIEWBOX, COUNTRY_PATHS, COUNTRY_NAMES, projectLatLon,
} from '@/lib/world-map';
import { num } from '@/lib/format';

const RAMP = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];

const parseView = (s) => {
  const [x, y, w, h] = s.split(' ').map(Number);
  return { x, y, w, h };
};

const PRESETS = {
  europe: parseView(EUROPE_VIEWBOX),
  world: parseView(WORLD_VIEWBOX),
};

const MIN_W = 12;     // najdublji zum
const MAX_W = PRESETS.world.w;

function quantileBreaks(values, classes) {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  return Array.from({ length: classes - 1 }, (_, i) =>
    sorted[Math.floor(((i + 1) / classes) * sorted.length)]);
}

function classOf(value, breaks) {
  if (!value) return -1;
  let i = 0;
  while (i < breaks.length && value >= breaks[i]) i++;
  return i;
}

export function GeoMap({
  countries = [],
  cities = [],
  onSelectCountry,
  selectedCountry,
  valueKey = 'pageviews',
  valueLabel = 'pregleda',
  live = false,
}) {
  const [view, setView] = useState(PRESETS.europe);
  const [mode, setMode] = useState('bubbles');
  const [hover, setHover] = useState(null);
  const [width, setWidth] = useState(800);

  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useRef(null);

  // Poluprečnik mehurića treba da ostane isti na ekranu bez obzira na zum
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byCountry = useMemo(
    () => new Map(countries.map((c) => [c.country, c])),
    [countries],
  );

  const breaks = useMemo(
    () => quantileBreaks(countries.map((c) => c[valueKey] ?? 0), RAMP.length),
    [countries, valueKey],
  );

  const maxCity = useMemo(
    () => cities.reduce((m, c) => Math.max(m, c[valueKey] ?? 0), 0),
    [cities, valueKey],
  );

  const pxToSvg = width > 0 ? view.w / width : 1;

  /** Površina kruga ∝ vrednosti, pa najveći grad ne pojede ostale. */
  const radiusFor = (value) => {
    if (!maxCity || !value) return 0;
    const px = 4 + Math.sqrt(value / maxCity) * 26;
    return px * pxToSvg;
  };

  const clientToSvg = useCallback((clientX, clientY) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * view.h,
    };
  }, [view]);

  const zoomAt = useCallback((factor, anchor) => {
    setView((v) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, v.w * factor));
      const k = w / v.w;
      const h = v.h * k;
      const a = anchor ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      return { x: a.x - (a.x - v.x) * k, y: a.y - (a.y - v.y) * k, w, h };
    });
  }, []);

  const onWheel = (e) => {
    e.preventDefault();
    zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, clientToSvg(e.clientX, e.clientY));
  };

  const onPointerDown = (e) => {
    drag.current = { startX: e.clientX, startY: e.clientY, view };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - d.startX) / rect.width) * d.view.w;
    const dy = ((e.clientY - d.startY) / rect.height) * d.view.h;
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
  };

  const endDrag = (e) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const visibleCities = cities
    .filter((c) => c.lat || c.lon)
    .map((c) => ({ ...c, ...projectLatLon(c.lat, c.lon) }))
    .filter((c) => c.x >= view.x - 20 && c.x <= view.x + view.w + 20
      && c.y >= view.y - 20 && c.y <= view.y + view.h + 20)
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0));

  const btn = 'rounded px-2.5 py-1 text-xs font-medium transition-colors';
  const btnOn = 'bg-[var(--series-1)] text-white';
  const btnOff = 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]';

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {[['europe', 'Evropa'], ['world', 'Svet']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setView(PRESETS[key])}
              className={`${btn} ${btnOff}`}>{label}</button>
          ))}
        </div>

        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {[['bubbles', 'Mehurići'], ['choropleth', 'Intenzitet']].map(([key, label]) => (
            <button key={key} type="button" onClick={() => setMode(key)}
              className={`${btn} ${mode === key ? btnOn : btnOff}`}>{label}</button>
          ))}
        </div>

        {live && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[var(--status-good)]/40 bg-[var(--status-good)]/10 px-2 py-1 text-xs font-medium text-[var(--status-good)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--status-good)]" />
            uživo
          </span>
        )}

        {selectedCountry && (
          <button type="button" onClick={() => onSelectCountry?.(null)}
            className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]">
            {COUNTRY_NAMES[selectedCountry] ?? selectedCountry} ✕
          </button>
        )}

        <span className="ml-auto hidden text-xs text-[var(--text-muted)] sm:block">
          Točkić za zum, prevlačenje za pomeranje
        </span>
      </div>

      <div ref={wrapRef} className="relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-1)]">
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block h-auto w-full cursor-grab touch-none active:cursor-grabbing"
          role="img"
          aria-label={`Mapa: ${valueLabel} po državama i gradovima`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <g>
            {Object.entries(COUNTRY_PATHS).map(([code, d]) => {
              const row = byCountry.get(code);
              const value = row?.[valueKey] ?? 0;
              const cls = classOf(value, breaks);
              const isSelected = selectedCountry === code;

              // U režimu mehurića podloga je neutralna, kao u GA
              const fill = mode === 'choropleth' && cls >= 0
                ? RAMP[Math.min(cls, RAMP.length - 1)]
                : 'var(--surface-2)';

              return (
                <path
                  key={code}
                  d={d}
                  fill={isSelected ? 'var(--series-1)' : fill}
                  fillOpacity={isSelected ? 0.25 : 1}
                  stroke={isSelected ? 'var(--series-1)' : 'var(--border)'}
                  strokeWidth={(isSelected ? 1.4 : 0.5) * pxToSvg}
                  className={row ? 'cursor-pointer' : ''}
                  onMouseEnter={() => row && setHover({
                    label: COUNTRY_NAMES[code] ?? code,
                    value,
                    sub: row.share !== undefined ? `${row.share}% ukupnog saobraćaja` : null,
                  })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => row && onSelectCountry?.(isSelected ? null : code)}
                />
              );
            })}
          </g>

          <g>
            {visibleCities.map((c) => {
              const r = radiusFor(c[valueKey]);
              if (r <= 0) return null;
              return (
                <circle
                  key={`${c.country}-${c.city}`}
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill="var(--series-1)"
                  fillOpacity={0.45}
                  stroke="var(--series-1)"
                  strokeOpacity={0.9}
                  strokeWidth={1 * pxToSvg}
                  className="cursor-pointer"
                  onMouseEnter={() => setHover({
                    label: `${c.city}, ${COUNTRY_NAMES[c.country] ?? c.country}`,
                    value: c[valueKey],
                    sub: null,
                  })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
          </g>
        </svg>

        {/* Zum kontrole, kao u GA — dole desno */}
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-0)] shadow">
          <button type="button" onClick={() => zoomAt(1 / 1.4)} aria-label="Uvećaj"
            className="px-2.5 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-2)]">+</button>
          <button type="button" onClick={() => zoomAt(1.4)} aria-label="Umanji"
            className="border-t border-[var(--border)] px-2.5 py-1.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-2)]">−</button>
          <button type="button" onClick={() => setView(PRESETS.europe)} aria-label="Vrati pogled"
            className="border-t border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-2)]">⤾</button>
        </div>

        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 shadow-lg">
            <div className="text-xs font-medium text-[var(--text-primary)]">{hover.label}</div>
            <div className="tabular text-sm font-semibold text-[var(--text-primary)]">
              {num(hover.value)}{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">{valueLabel}</span>
            </div>
            {hover.sub && <div className="text-xs text-[var(--text-muted)]">{hover.sub}</div>}
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-muted)]">
        {mode === 'bubbles' ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: 'var(--series-1)', opacity: 0.45 }} />
            <span className="inline-block h-3.5 w-3.5 rounded-full" style={{ background: 'var(--series-1)', opacity: 0.45 }} />
            <span>Površina kruga ∝ {valueLabel}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span>{valueLabel}:</span>
            <span className="flex overflow-hidden rounded">
              {RAMP.map((c) => <span key={c} className="h-2.5 w-8" style={{ background: c }} />)}
            </span>
            <span className="tabular">
              {breaks.length ? `< ${num(breaks[0])} … ≥ ${num(breaks[breaks.length - 1])}` : '—'}
            </span>
          </div>
        )}
        <span className="ml-auto">
          {mode === 'choropleth'
            ? 'Skala je kvantilna — svaka nijansa nosi približno isti broj država.'
            : 'Klik na državu filtrira gradove ispod.'}
        </span>
      </div>
    </div>
  );
}
