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
  WORLD_VIEWBOX, EUROPE_VIEWBOX, COUNTRY_PATHS, COUNTRY_NAMES, COUNTRY_SHORT,
  COUNTRY_CENTROIDS, COUNTRY_BOUNDS, projectLatLon,
} from '@/lib/world-map';
import { num, compact } from '@/lib/format';

const RAMP = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];

const parseView = (s) => {
  const [x, y, w, h] = s.split(' ').map(Number);
  return { x, y, w, h };
};

const PRESETS = {
  europe: parseView(EUROPE_VIEWBOX),
  world: parseView(WORLD_VIEWBOX),
};

const MIN_W = 12;
const MAX_W = PRESETS.world.w;

// Natpisi u px, nezavisno od zuma
const COUNTRY_FONT_PX = 11;
const CITY_FONT_PX = 10;
const PLACE_FONT_PX = 9;

/**
 * Koliko detalja podloge se prikazuje na kom nivou uvećanja.
 * Prag je širina viewBox-a: manja širina = dublji zum = više gradova.
 * Vrednosti su birane tako da svaki nivo doda vidljiv sloj, a ne kašu.
 */
function placeTierFor(viewWidth) {
  if (viewWidth > 400) return 0;   // ceo svet: samo milionski gradovi
  if (viewWidth > 200) return 1;
  if (viewWidth > 100) return 2;
  if (viewWidth > 45) return 3;
  return 4;                        // duboki zum: sve, do 5.000 stanovnika
}

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

/**
 * Pohlepno raspoređivanje natpisa: ide se od najvažnijeg, natpis se odbacuje
 * ako se preklapa sa već postavljenim. Bolje nego prikazati sve pa da se
 * imena preklapaju u nečitljivu kašu.
 */
function makePlacer() {
  const placed = [];
  return (box) => {
    for (const p of placed) {
      if (box.x1 > p.x0 && box.x0 < p.x1 && box.y1 > p.y0 && box.y0 < p.y1) return false;
    }
    placed.push(box);
    return true;
  };
}

/** Gruba procena širine teksta — dovoljna za sprečavanje preklapanja. */
const textWidth = (text, fontPx) => text.length * fontPx * 0.55;

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
  const [subdivisions, setSubdivisions] = useState(null);
  const [places, setPlaces] = useState(null);

  /**
   * Podloga — unutrašnje granice i gradovi — ide u zasebne module i učitava se
   * tek kad se mapa prikaže.
   *
   * Bez nje mapa pokazuje samo gradove koji imaju saobraćaj, pa Srbija izgleda
   * kao prazna mrlja sa pet tačaka. Podloga daje geografski kontekst: čitalac
   * vidi GDE je Kragujevac u odnosu na gradove koji tog dana nemaju posetu.
   *
   * Ovi moduli ne treba da opterete ekrane koji mapu uopšte ne koriste.
   */
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/lib/world-subdivisions').then((m) => m.SUBDIVISION_PATHS).catch(() => null),
      import('@/lib/world-places').then((m) => m.PLACES).catch(() => null),
    ]).then(([subs, pls]) => {
      if (cancelled) return;
      if (subs) setSubdivisions(subs);
      if (pls) setPlaces(pls);
    });
    return () => { cancelled = true; };
  }, []);

  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const drag = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoomAt = useCallback((factor, anchor) => {
    setView((v) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, v.w * factor));
      const k = w / v.w;
      const h = v.h * k;
      const a = anchor ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      return { x: a.x - (a.x - v.x) * k, y: a.y - (a.y - v.y) * k, w, h };
    });
  }, []);

  /**
   * Wheel MORA da ide kao nativni listener sa { passive: false }.
   * React kači wheel pasivno na koren dokumenta, pa `e.preventDefault()` u
   * React handleru nema efekta — zumira se mapa, ali se istovremeno skroluje
   * i stranica.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;

    const onWheel = (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const v = viewRef.current;
      const anchor = {
        x: v.x + ((e.clientX - rect.left) / rect.width) * v.w,
        y: v.y + ((e.clientY - rect.top) / rect.height) * v.h,
      };
      zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, anchor);
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

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

  const radiusFor = (value) => {
    if (!maxCity || !value) return 0;
    return (4 + Math.sqrt(value / maxCity) * 26) * pxToSvg;
  };

  const onPointerDown = (e) => {
    drag.current = { startX: e.clientX, startY: e.clientY, view, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - d.startX) / rect.width) * d.view.w;
    const dy = ((e.clientY - d.startY) / rect.height) * d.view.h;
    if (Math.abs(e.clientX - d.startX) > 3 || Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
  };

  const endDrag = (e) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const visibleCities = useMemo(() => cities
    .filter((c) => c.lat || c.lon)
    .map((c) => ({ ...c, ...projectLatLon(c.lat, c.lon) }))
    .filter((c) => c.x >= view.x - 20 && c.x <= view.x + view.w + 20
      && c.y >= view.y - 20 && c.y <= view.y + view.h + 20)
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0)), [cities, view, valueKey]);

  /**
   * Gradovi podloge: filtriraju se po nivou detalja i vidnom polju, pa se
   * izbacuju oni na kojima već stoji mehurić sa podacima — inače bi isti grad
   * dobio dva natpisa, jednom kao podatak, jednom kao podloga.
   */
  const basePlaces = useMemo(() => {
    if (!places) return [];
    const tier = placeTierFor(view.w);
    const pad = view.w * 0.05;

    // Mesta na kojima već stoji mehurić
    const taken = visibleCities.map((c) => [c.x, c.y]);
    const tooClose = 1.5 * pxToSvg;

    const out = [];
    for (const [name, x, y, t] of places) {
      if (t > tier) continue;
      if (x < view.x - pad || x > view.x + view.w + pad) continue;
      if (y < view.y - pad || y > view.y + view.h + pad) continue;
      if (taken.some(([tx, ty]) => Math.abs(tx - x) < tooClose && Math.abs(ty - y) < tooClose)) continue;
      out.push({ name, x, y, tier: t });
      if (out.length >= 400) break;   // zastita od patoloskih zumova
    }
    return out;
  }, [places, view, pxToSvg, visibleCities]);

  /**
   * Sloj unutrašnjih granica se pravi jednom po nivou zuma. Pri prevlačenju
   * se menja samo viewBox, a pxToSvg ostaje isti — bez ovoga bi React na
   * svaki frejm ponovo gradio ~500 <path> elemenata.
   */
  const subdivisionLayer = useMemo(() => {
    if (!subdivisions) return null;
    return (
      <g fill="none" stroke="var(--border)" strokeOpacity={0.85} pointerEvents="none">
        {subdivisions.map((d, i) => (
          <path key={i} d={d} strokeWidth={0.4 * pxToSvg} />
        ))}
      </g>
    );
  }, [subdivisions, pxToSvg]);

  /** Natpisi država i gradova, sa izbegavanjem preklapanja. */
  const labels = useMemo(() => {
    const fits = makePlacer();
    const countryFont = COUNTRY_FONT_PX * pxToSvg;
    const cityFont = CITY_FONT_PX * pxToSvg;

    const inView = (x, y) => x >= view.x && x <= view.x + view.w
      && y >= view.y && y <= view.y + view.h;

    /** Postavlja natpis države ako staje u nju i ne sudara se sa već postavljenim. */
    const placeCountry = (code, hasData) => {
      const centroid = COUNTRY_CENTROIDS[code];
      const b = COUNTRY_BOUNDS[code];
      if (!centroid || !b) return null;

      const [x, y] = centroid;
      if (!inView(x, y)) return null;

      const text = COUNTRY_SHORT[code] ?? code;
      // Ako natpis ne staje u samu državu, bolje ga nema
      if ((b[2] - b[0]) / pxToSvg < textWidth(text, COUNTRY_FONT_PX) * 0.85) return null;

      const w = textWidth(text, countryFont);
      if (!fits({
        x0: x - w / 2, x1: x + w / 2,
        y0: y - countryFont * 0.8, y1: y + countryFont * 0.5,
      })) return null;

      return { key: `n-${code}`, x, y, text, font: countryFont, hasData };
    };

    const countryLabels = [];

    // Redosled je bitan. Prvo države SA podacima: na srednjem zumu je "Srbija"
    // korisnija od "Beograd", a centroid zemlje i njena prestonica su tu toliko
    // blizu da se natpisi sudaraju. Na dubljem zumu su dovoljno razmaknuti pa
    // se ispišu oba.
    const withData = [...byCountry.keys()]
      .sort((a, b) => (byCountry.get(b)?.[valueKey] ?? 0) - (byCountry.get(a)?.[valueKey] ?? 0));
    for (const code of withData) {
      const l = placeCountry(code, true);
      if (l) countryLabels.push(l);
    }

    // Gradovi se ispisuju tek kad ih ima smisla razlikovati
    const cityLabels = [];
    if (view.w <= PRESETS.europe.w * 0.75) {
      for (const c of visibleCities.slice(0, 60)) {
        const r = radiusFor(c[valueKey]);
        const w = textWidth(c.city, cityFont);
        const y = c.y - r - cityFont * 0.45;
        if (fits({ x0: c.x - w / 2, x1: c.x + w / 2, y0: y - cityFont, y1: y + cityFont * 0.3 })) {
          cityLabels.push({ key: `c-${c.country}-${c.city}`, x: c.x, y, text: c.city, font: cityFont });
        }
      }
    }

    // Gradovi podloge: posle podataka, pre država bez podataka
    const placeFont = PLACE_FONT_PX * pxToSvg;
    const placeLabels = [];
    for (const p of basePlaces) {
      const w = textWidth(p.name, placeFont);
      const y = p.y - 1.6 * pxToSvg;
      if (fits({
        x0: p.x - w / 2, x1: p.x + w / 2,
        y0: y - placeFont, y1: y + placeFont * 0.3,
      })) {
        placeLabels.push({ key: `p-${p.name}-${p.x}`, x: p.x, y, text: p.name, font: placeFont });
      }
    }

    // Tek na kraju države bez podataka - one su samo kontekst
    for (const code of Object.keys(COUNTRY_CENTROIDS)) {
      if (byCountry.has(code)) continue;
      const l = placeCountry(code, false);
      if (l) countryLabels.push(l);
    }

    return { cityLabels, countryLabels, placeLabels };
  }, [visibleCities, byCountry, basePlaces, view, pxToSvg, valueKey, maxCity]);

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

      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-1)]"
        style={{ overscrollBehavior: 'contain' }}
      >
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
          role="img"
          aria-label={`Mapa: ${valueLabel} po državama i gradovima`}
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
                  onClick={() => {
                    if (drag.current?.moved) return;   // prevlačenje nije klik
                    if (row) onSelectCountry?.(isSelected ? null : code);
                  }}
                />
              );
            })}
          </g>

          {/* Unutrašnje granice — tanje i svetlije od državnih */}
          {subdivisionLayer}

          {/* Gradovi podloge — sitne tačke, ispod svega ostalog */}
          <g pointerEvents="none">
            {basePlaces.map((p) => (
              <circle
                key={`bp-${p.name}-${p.x}`}
                cx={p.x}
                cy={p.y}
                r={1.1 * pxToSvg}
                fill="var(--text-muted)"
                fillOpacity={0.55}
              />
            ))}
          </g>

          <g pointerEvents="none">
            {labels.placeLabels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontSize={l.font}
                fill="var(--text-muted)"
                stroke="var(--surface-1)"
                strokeWidth={2.5 * pxToSvg}
                paintOrder="stroke"
              >
                {l.text}
              </text>
            ))}
          </g>

          {/* Natpisi država — ispod mehurića, da ih krugovi ne prekriju */}
          <g pointerEvents="none">
            {labels.countryLabels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontSize={l.font}
                fill={l.hasData ? 'var(--text-secondary)' : 'var(--text-muted)'}
                stroke="var(--surface-1)"
                strokeWidth={3 * pxToSvg}
                paintOrder="stroke"
                style={{ fontWeight: l.hasData ? 600 : 400 }}
              >
                {l.text}
              </text>
            ))}
          </g>

          {/* Mehurići postoje samo u svom režimu — u "Intenzitetu" istu
              vrednost već nosi boja države, pa bi dva prikaza iste stvari
              samo smetala jedan drugom. */}
          {mode === 'bubbles' && (
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
          )}

          {/* Natpisi gradova — iznad svega, sa oreolom radi čitljivosti */}
          {mode === 'bubbles' && (
          <g pointerEvents="none">
            {labels.cityLabels.map((l) => (
              <text
                key={l.key}
                x={l.x}
                y={l.y}
                textAnchor="middle"
                fontSize={l.font}
                fill="var(--text-primary)"
                stroke="var(--surface-1)"
                strokeWidth={3 * pxToSvg}
                paintOrder="stroke"
                style={{ fontWeight: 600 }}
              >
                {l.text}
              </text>
            ))}
          </g>
          )}
        </svg>

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
              {breaks.length ? `< ${compact(breaks[0])} … ≥ ${compact(breaks[breaks.length - 1])}` : '—'}
            </span>
          </div>
        )}
        <span className="text-[10px] text-[var(--text-muted)]">
          Podloga: Natural Earth ·{' '}
          <a href="https://www.geonames.org/" target="_blank" rel="noreferrer" className="underline">
            GeoNames
          </a>{' '}
          (CC BY 4.0)
        </span>
        <span className="ml-auto">
          {mode === 'choropleth'
            ? 'Skala je kvantilna — svaka nijansa nosi približno isti broj država.'
            : view.w > PRESETS.europe.w * 0.75
              ? 'Zumirajte da se ispišu i nazivi gradova.'
              : 'Klik na državu filtrira gradove ispod.'}
        </span>
      </div>
    </div>
  );
}
