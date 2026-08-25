'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Card, DataTable, RangePicker, Loading, ErrorNote, Button, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { BarList, TimeSeries, HeatmapTable } from '@/components/charts';
import { pct, duration, dateLabel, trendClass, trendArrow } from '@/lib/format';

export default function CategoriesPage() {
  const [days, setDays] = useState(7);
  const [root, setRoot] = useState(null);
  const [selected, setSelected] = useState([]);

  const { data, error, isLoading } = useSWR(
    `/categories?days=${days}${root ? `&root=${encodeURIComponent(root)}` : ''}`,
    fetcher,
  );
  const { data: channels } = useSWR(`/categories/channels?days=${days}`, fetcher);
  const { data: comparison } = useSWR(
    selected.length ? `/categories/compare?days=${days}&categories=${encodeURIComponent(selected.join(','))}` : null,
    fetcher,
  );

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  function toggleSelect(category) {
    setSelected((prev) => (prev.includes(category)
      ? prev.filter((c) => c !== category)
      : prev.length < 6 ? [...prev, category] : prev));
  }

  // Poređenje: jedna tačka po datumu, jedna kolona po kategoriji
  const compareData = (() => {
    if (!comparison?.series?.length) return [];
    const dates = [...new Set(comparison.series.flatMap((s) => s.points.map((p) => p.date)))].sort();
    return dates.map((date) => {
      const row = { date: dateLabel(date) };
      for (const s of comparison.series) {
        row[s.category] = s.points.find((p) => p.date === date)?.pageviews ?? 0;
      }
      return row;
    });
  })();

  return (
    <>
      <PageHeader
        title="Kategorije"
        description={root
          ? `Podkategorije unutar „${root}”`
          : 'Korenske kategorije. Klik na red otvara nivo niže.'}
      >
        {root && <Button onClick={() => { setRoot(null); setSelected([]); }}>← Nazad na sve</Button>}
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Pregledi po kategoriji">
          <BarList
            data={data.categories.slice(0, 12)}
            labelKey="category"
            valueKey="pageviews"
            height={Math.max(220, data.categories.slice(0, 12).length * 26)}
          />
        </Card>

        <Card
          title="Poređenje kategorija"
          subtitle={selected.length
            ? `Izabrano: ${selected.join(', ')}`
            : 'Označite do 6 kategorija u tabeli ispod'}
        >
          {compareData.length ? (
            <TimeSeries
              data={compareData}
              series={selected.map((c) => ({ key: c, label: c }))}
            />
          ) : (
            <p className="py-16 text-center text-sm text-[var(--text-muted)]">
              Označite kategorije da biste ih uporedili na jednom grafiku.
            </p>
          )}
        </Card>
      </div>

      <div className="mb-5">
        <Card title={root ? `Podkategorije: ${root}` : 'Sve kategorije'}>
          <DataTable
            columns={[
              {
                key: 'category',
                label: 'Kategorija',
                render: (r) => (
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.includes(r.category)}
                      onChange={() => toggleSelect(r.category)}
                      onClick={(e) => e.stopPropagation()}
                      className="accent-[var(--series-1)]"
                    />
                    <span className="font-medium">{r.category}</span>
                  </label>
                ),
              },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
              { key: 'articlesPublished', label: 'Članaka', align: 'right' },
              {
                key: 'avgTimeOnPageSec',
                label: 'Vreme',
                align: 'right',
                render: (r) => (r.avgTimeOnPageSec ? duration(r.avgTimeOnPageSec) : '—'),
              },
              {
                key: 'readCompletionRate',
                label: 'Pročitanost',
                align: 'right',
                render: (r) => (r.readCompletionRate ? pct(r.readCompletionRate) : '—'),
              },
              {
                key: 'trendPct',
                label: 'Trend',
                align: 'right',
                render: (r) => (
                  <span className={`tabular ${trendClass(r.trendPct)}`}>
                    {trendArrow(r.trendPct)} {pct(Math.abs(r.trendPct))}
                  </span>
                ),
              },
            ]}
            rows={data.categories}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
            onRowClick={!root ? (r) => setRoot(r.category) : undefined}
          />
        </Card>
      </div>

      {channels?.rows?.length > 0 && (
        <Card
          title="Kanal × kategorija"
          subtitle="Isti podatak drugačije presečen — pokazuje odakle koja rubrika stvarno živi"
        >
          <HeatmapTable
            rows={channels.rows.slice(0, 15)}
            columns={channels.sources}
            rowLabel="Kategorija"
            columnLabel={(c) => c.label}
            getValue={(r, c) => r.bySource[c.source]}
          />
          <div className="mt-3">
            <Note>
              Vrednosti su pregledi; boja je samo pojačanje. Ako NBA vesti dolaze sa Google-a a
              Superliga sa Facebook-a, ovde se to vidi kao razlika u redu, ne u nijansi.
            </Note>
          </div>
        </Card>
      )}
    </>
  );
}
