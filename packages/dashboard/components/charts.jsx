'use client';

/**
 * Grafici (Recharts).
 *
 * Pravila koja se ovde poštuju:
 *  - kategorijalne boje se dodeljuju fiksnim redom i nikad se ne cikliraju
 *  - jedna osa; nikad dve y-skale na istom grafiku
 *  - legenda uvek kad ima 2+ serije, plus direktne oznake za do 4 serije
 *  - tanke linije (2px), diskretna mreža, tooltip po difoltu
 *  - uz svaki grafik postoji i tabelarni prikaz (pristupačnost + kontrast)
 */

import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { num, compact } from '@/lib/format';

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
];

/** Boja po identitetu entiteta, ne po rangu - filter ne sme da prefarba serije. */
export function colorFor(key, keys) {
  const idx = keys.indexOf(key);
  return SERIES[(idx >= 0 ? idx : 0) % SERIES.length];
}

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--text-muted)', fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: 'var(--border)' },
};

function TooltipBox({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 shadow-lg">
      <div className="mb-1 text-xs font-medium text-[var(--text-secondary)]">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey ?? p.name} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color ?? p.fill }} />
          <span className="text-[var(--text-secondary)]">{p.name}</span>
          <span className="tabular ml-auto font-medium text-[var(--text-primary)]">
            {formatter ? formatter(p.value) : num(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Vremenska serija. `series` = [{key, label}] - fiksni redosled boja. */
export function TimeSeries({ data, series, xKey = 'date', height = 260, formatter, area = false }) {
  const Chart = area ? AreaChart : LineChart;
  const showLegend = series.length >= 2;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={46} tickFormatter={compact} />
        <Tooltip content={<TooltipBox formatter={formatter} />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
        {showLegend && (
          <Legend
            verticalAlign="top"
            align="left"
            height={28}
            iconType="plainline"
            wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }}
          />
        )}
        {series.map((s, i) => (area ? (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES[i % SERIES.length]}
            fill={SERIES[i % SERIES.length]}
            fillOpacity={0.12}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
          />
        ) : (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface-1)' }}
          />
        )))}
      </Chart>
    </ResponsiveContainer>
  );
}

/** Horizontalne trake za rangiranje - najčitljivija forma za "ko je najveći". */
export function BarList({ data, labelKey, valueKey, height = 280, color = 'var(--series-1)', formatter }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 48, bottom: 4, left: 8 }}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={compact} />
        <YAxis
          type="category"
          dataKey={labelKey}
          {...axisProps}
          width={150}
          tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
        />
        <Tooltip content={<TooltipBox formatter={formatter} />} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} barSize={14}>
          <LabelList
            dataKey={valueKey}
            position="right"
            formatter={compact}
            style={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Grupisane trake (npr. danas vs prošla nedelja). */
export function GroupedBars({ data, xKey, series, height = 260, formatter }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={16} />
        <YAxis {...axisProps} width={46} tickFormatter={compact} />
        <Tooltip content={<TooltipBox formatter={formatter} />} cursor={{ fill: 'var(--surface-2)' }} />
        {series.length >= 2 && (
          <Legend verticalAlign="top" align="left" height={28}
            wrapperStyle={{ fontSize: 12, color: 'var(--text-secondary)' }} />
        )}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label}
            fill={SERIES[i % SERIES.length]} radius={[4, 4, 0, 0]} maxBarSize={22} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * Donut za sastav celine. Maksimum 6 kriški (ostatak ide u "Ostalo") i
 * svaka nosi direktnu oznaku - identitet nikad ne zavisi samo od boje.
 */
export function Donut({ data, labelKey = 'label', valueKey = 'pageviews', height = 260 }) {
  const top = data.slice(0, 5);
  const rest = data.slice(5);
  const restTotal = rest.reduce((s, d) => s + Number(d[valueKey] || 0), 0);
  const slices = restTotal > 0
    ? [...top, { [labelKey]: 'Ostalo', [valueKey]: restTotal }]
    : top;

  const total = slices.reduce((s, d) => s + Number(d[valueKey] || 0), 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={slices}
              dataKey={valueKey}
              nameKey={labelKey}
              innerRadius="58%"
              outerRadius="86%"
              paddingAngle={2}
              stroke="var(--surface-1)"
              strokeWidth={2}
            >
              {slices.map((s, i) => (
                <Cell key={s[labelKey]} fill={SERIES[i % SERIES.length]} />
              ))}
            </Pie>
            <Tooltip content={<TooltipBox />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Direktne oznake: ime + udeo, uz uzorak boje */}
      <ul className="w-full shrink-0 space-y-1.5 sm:w-52">
        {slices.map((s, i) => (
          <li key={s[labelKey]} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="truncate text-[var(--text-secondary)]">{s[labelKey]}</span>
            <span className="tabular ml-auto font-medium text-[var(--text-primary)]">
              {total > 0 ? `${((s[valueKey] / total) * 100).toFixed(1)}%` : '0%'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Levak (scroll dubina) - ordinalna rampa, jedna nijansa. */
export function Funnel({ steps }) {
  const ordinal = ['var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];
  const base = steps[0]?.users || 1;

  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={s.depth} className="flex items-center gap-3">
          <span className="tabular w-12 shrink-0 text-xs text-[var(--text-secondary)]">{s.depth}%</span>
          <div className="h-6 flex-1 overflow-hidden rounded bg-[var(--surface-2)]">
            <div
              className="h-full rounded transition-all"
              style={{ width: `${Math.min(100, (s.users / base) * 100)}%`, background: ordinal[i] }}
            />
          </div>
          <span className="tabular w-24 shrink-0 text-right text-xs text-[var(--text-primary)]">
            {num(s.users)} <span className="text-[var(--text-muted)]">({s.pct}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Heatmap tabela (kanal x kategorija). Sekvencijalna rampa - jedna nijansa,
 * svetlo do tamno; vrednost je uvek ispisana, boja je pojačanje a ne nosilac.
 */
export function HeatmapTable({ rows, columns, getValue, rowLabel, columnLabel }) {
  const values = rows.flatMap((r) => columns.map((c) => getValue(r, c) ?? 0));
  const max = Math.max(1, ...values);
  const ramp = ['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'];

  const cellStyle = (v) => {
    if (!v) return {};
    const step = Math.min(ramp.length - 1, Math.floor((v / max) * ramp.length));
    return {
      background: ramp[step],
      color: step >= 2 ? '#ffffff' : 'var(--text-primary)',
    };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              {rowLabel}
            </th>
            {columns.map((c) => (
              <th key={c.key ?? c} className="px-2 py-2 text-right text-xs font-medium text-[var(--text-muted)]">
                {columnLabel ? columnLabel(c) : c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key ?? r.category ?? r.source}>
              <td className="whitespace-nowrap px-3 py-1.5 text-[var(--text-primary)]">
                {r.category ?? r.label ?? r.source}
              </td>
              {columns.map((c) => {
                const v = getValue(r, c) ?? 0;
                return (
                  <td key={c.key ?? c} className="px-1 py-1">
                    <div
                      className="tabular rounded px-2 py-1 text-right text-xs"
                      style={cellStyle(v)}
                      title={`${num(v)}`}
                    >
                      {v ? compact(v) : '–'}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mini linija bez ose - samo oblik trenda uz broj. */
export function Sparkline({ data, dataKey = 'pageviews', height = 40, color = 'var(--series-1)' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.14} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
