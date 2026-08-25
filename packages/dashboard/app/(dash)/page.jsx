'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Card, StatTile, DataTable, RangePicker, Loading, ErrorNote, Badge, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { TimeSeries, GroupedBars, Donut } from '@/components/charts';
import { num, pct, hourLabel, dateTimeLabel } from '@/lib/format';

export default function OverviewPage() {
  const [days, setDays] = useState(7);

  const { data, error, isLoading } = useSWR(`/overview?days=${days}`, fetcher, {
    refreshInterval: 60_000,
  });

  // Real-time widget se osvežava na 10s (sekcija 10.1)
  const { data: live } = useSWR('/realtime', fetcher, { refreshInterval: 10_000 });

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const hourly = data.hourly.map((h) => ({
    hour: hourLabel(h.hour),
    danas: h.today,
    proslaNedelja: h.lastWeek,
  }));

  return (
    <>
      <PageHeader
        title="Pregled"
        description={`tvarenasport.${data.site} · period ${data.range.from} – ${data.range.to}`}
      >
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>

      {data.spike && <SpikeBanner spike={data.spike} />}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Aktivni sada"
          value={num(live?.activeVisitors ?? 0)}
          hint="poslednjih 5 minuta"
        />
        <StatTile
          label="Pregledi"
          value={num(data.totals.pageviews)}
          trend={data.totals.trendPct}
          hint="u odnosu na prethodni period"
        />
        <StatTile
          label="Jedinstveni posetioci"
          value={num(data.totals.uniqueVisitors)}
        />
        <StatTile
          label="Pregleda / minut"
          value={num((live?.pageviews5m ?? 0) / 5)}
          hint="prosek poslednjih 5 min"
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card
          title="Pregledi po satu"
          subtitle="Danas naspram istog dana prošle nedelje"
          className="lg:col-span-2"
        >
          <GroupedBars
            data={hourly}
            xKey="hour"
            series={[
              { key: 'danas', label: 'Danas' },
              { key: 'proslaNedelja', label: 'Prošle nedelje' },
            ]}
          />
        </Card>

        <Card title="Odakle dolazi saobraćaj" subtitle={`Ukupno ${num(data.totals.pageviews)} pregleda`}>
          <Donut data={data.sources} labelKey="label" valueKey="pageviews" height={220} />
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card
          title="Uživo — poslednjih 30 minuta"
          subtitle="Direktno iz ClickHouse-a, osvežava se na 10 sekundi"
        >
          {live?.perMinute?.length ? (
            <TimeSeries
              data={live.perMinute}
              xKey="minute"
              series={[{ key: 'pageviews', label: 'Pregledi' }]}
              height={200}
              area
            />
          ) : (
            <Loading label="Čekam prvi minut podataka…" />
          )}
        </Card>

        <Card title="Najčitanije upravo sada" subtitle="Poslednjih 5 minuta">
          <DataTable
            columns={[
              {
                key: 'title',
                label: 'Naslov',
                render: (r) => (
                  <Link href={`/clanci/${r.articleId}`} className="line-clamp-2 hover:underline">
                    {r.title}
                  </Link>
                ),
              },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
            ]}
            rows={live?.topArticles ?? []}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
            empty="Trenutno nema saobraćaja."
          />
        </Card>
      </div>

      <Card title="Najčitaniji tekstovi (24h)">
        <DataTable
          columns={[
            {
              key: 'title',
              label: 'Naslov',
              render: (r) => (
                <Link href={`/clanci/${r.articleId}`} className="line-clamp-2 hover:underline">
                  {r.title}
                </Link>
              ),
            },
            { key: 'author', label: 'Autor', render: (r) => r.author || '—' },
            { key: 'category', label: 'Kategorija', render: (r) => r.category || '—' },
            { key: 'pageviews24h', label: '24h', align: 'right' },
            { key: 'pageviewsTotal', label: 'Ukupno', align: 'right' },
            {
              key: 'trendingScore',
              label: 'Trending',
              align: 'right',
              render: (r) => (r.trendingScore > 2
                ? <Badge tone="warning">{r.trendingScore.toFixed(1)}</Badge>
                : <span className="text-[var(--text-muted)]">{r.trendingScore.toFixed(1)}</span>),
            },
          ]}
          rows={data.topArticles}
          initialSort={{ key: 'pageviews24h', dir: 'desc' }}
        />
      </Card>

      <div className="mt-5">
        <Card title="Kanali — tabelarni prikaz">
          <DataTable
            columns={[
              { key: 'label', label: 'Kanal' },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
              { key: 'share', label: 'Udeo', align: 'right', render: (r) => pct(r.share) },
              {
                key: 'bounceRate',
                label: 'Bounce',
                align: 'right',
                render: (r) => (r.bounceRate ? pct(r.bounceRate) : '—'),
              },
            ]}
            rows={data.sources}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
          />
          <div className="mt-3">
            <Note>
              Bounce rate je grubo merilo za news portal. Za stvarnu pročitanost gledajte
              read completion na ekranu članka — on razdvaja „kliknuo pa izašao” od „stvarno pročitao”.
            </Note>
          </div>
        </Card>
      </div>
    </>
  );
}

function SpikeBanner({ spike }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--status-warning)]/50 bg-[var(--status-warning)]/10 px-4 py-3">
      <span className="text-sm font-semibold text-[var(--status-warning)]">⚡ Spike u toku</span>
      <span className="tabular text-sm text-[var(--text-primary)]">
        {num(spike.pageviewsPerMin)} pregleda/min · {spike.multiplier.toFixed(1)}× iznad proseka
      </span>
      <span className="text-sm text-[var(--text-secondary)]">
        Vuče: <strong className="text-[var(--text-primary)]">{spike.driverValue}</strong>
      </span>
      <span className="ml-auto text-xs text-[var(--text-muted)]">{dateTimeLabel(spike.detectedAt)}</span>
    </div>
  );
}
