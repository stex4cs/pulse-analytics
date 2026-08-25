'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher, downloadCsv } from '@/lib/api';
import { Card, DataTable, RangePicker, Loading, ErrorNote, Button, Badge, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { HeatmapTable, SERIES } from '@/components/charts';
import { num, pct } from '@/lib/format';

const DIMENSIONS = [
  { value: 'author', label: 'Autori', href: (e) => `/autori/${encodeURIComponent(e)}` },
  { value: 'category', label: 'Kategorije', href: null },
  { value: 'tag', label: 'Tagovi', href: null },
];

export default function ChannelsByEntityPage() {
  const [dimension, setDimension] = useState('author');
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState('share');

  const { data, error, isLoading } = useSWR(
    `/channels?dimension=${dimension}&days=${days}&limit=40`,
    fetcher,
  );

  if (error) return <ErrorNote error={error} />;

  const dim = DIMENSIONS.find((d) => d.value === dimension);

  return (
    <>
      <PageHeader
        title="Odakle klikovi"
        description="Isti presek za autore, kategorije i tagove — ko živi od pretrage, ko od društvenih mreža, ko od Discover talasa."
      >
        <RangePicker value={days} onChange={setDays} />
        <Button onClick={() => downloadCsv(
          `/channels/export.csv?dimension=${dimension}&days=${days}`,
          `pulse-kanali-${dimension}-${days}d.csv`,
        )}
        >
          CSV
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {DIMENSIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => setDimension(d.value)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors
                ${dimension === d.value
                ? 'bg-[var(--series-1)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {[['share', 'Udeo %'], ['absolute', 'Pregledi']].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setMode(v)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${mode === v
                ? 'bg-[var(--series-1)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? <Loading /> : (
        <>
          <div className="mb-4">
            <Note>
              <strong>Udeo</strong> se čita drugačije od <strong>pregleda</strong>: 60% sa
              Facebook-a znači nešto sasvim drugo za autora sa 200.000 pregleda nego za autora
              sa 2.000. Prosek sajta je u redu ispod — sve što od njega bitno odstupa je priča.
            </Note>
          </div>

          <div className="mb-5">
            <Card title="Prosek sajta" subtitle={`Period ${data.range.from} – ${data.range.to}`}>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {data.sources.map((s, i) => (
                  <div key={s.source} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: SERIES[i % SERIES.length] }}
                    />
                    <span className="text-sm text-[var(--text-secondary)]">{s.label}</span>
                    <span className="tabular text-sm font-medium text-[var(--text-primary)]">
                      {pct(s.share)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div className="mb-5">
            <Card
              title={`${dim.label} × kanal`}
              subtitle={mode === 'share' ? 'Udeo kanala unutar entiteta' : 'Apsolutni broj pregleda'}
            >
              <HeatmapTable
                rows={data.rows.map((r) => ({
                  ...r,
                  category: r.entity,
                  bySource: mode === 'share' ? r.shares : r.bySource,
                }))}
                columns={data.sources.map((s) => s.source)}
                rowLabel={data.dimensionLabel}
                columnLabel={(c) => (data.sources.find((s) => s.source === c)?.label ?? c)}
                getValue={(r, c) => r.bySource[c]}
              />
            </Card>
          </div>

          <Card title="Tabelarni prikaz" subtitle="Sortirajte po koloni da nađete odstupanja">
            <DataTable
              columns={[
                {
                  key: 'entity',
                  label: data.dimensionLabel,
                  render: (r) => (dim.href
                    ? <Link href={dim.href(r.entity)} className="font-medium hover:underline">{r.entity}</Link>
                    : <span className="font-medium">{r.entity}</span>),
                },
                { key: 'total', label: 'Pregledi', align: 'right' },
                {
                  key: 'topSource',
                  label: 'Najjači kanal',
                  render: (r) => {
                    const label = data.sources.find((s) => s.source === r.topSource)?.label ?? r.topSource;
                    // Preko 50% iz jednog kanala je rizik, ne uspeh
                    return r.topShare >= 50
                      ? <Badge tone="warning">{label} {pct(r.topShare)}</Badge>
                      : <span className="text-[var(--text-secondary)]">{label} {pct(r.topShare)}</span>;
                  },
                },
                ...data.sources.slice(0, 5).map((s) => ({
                  key: s.source,
                  label: s.label,
                  align: 'right',
                  render: (r) => (mode === 'share'
                    ? (r.shares[s.source] ? pct(r.shares[s.source]) : '—')
                    : num(r.bySource[s.source] ?? 0)),
                })),
              ]}
              rows={data.rows.map((r) => ({
                ...r,
                id: r.entity,
                ...Object.fromEntries(data.sources.map((s) => [
                  s.source, mode === 'share' ? (r.shares[s.source] ?? 0) : (r.bySource[s.source] ?? 0),
                ])),
              }))}
              initialSort={{ key: 'total', dir: 'desc' }}
            />
            <div className="mt-3">
              <Note>
                Žuta oznaka znači da jedan kanal nosi preko 50% saobraćaja. To nije uspeh nego
                <strong> rizik</strong>: promena Facebook algoritma ili Discover ciklusa ruši taj
                entitet preko noći. Razvučeni izvori su stabilniji.
              </Note>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
