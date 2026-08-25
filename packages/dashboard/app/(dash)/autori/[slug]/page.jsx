'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Card, StatTile, DataTable, RangePicker, Loading, ErrorNote } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { TimeSeries, BarList, Donut } from '@/components/charts';
import { num, pct, duration, dateLabel } from '@/lib/format';

export default function AuthorDetailPage({ params }) {
  const { slug } = use(params);
  const [days, setDays] = useState(30);

  const { data, error, isLoading } = useSWR(
    `/authors/${encodeURIComponent(slug)}?days=${days}`,
    fetcher,
  );

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const series = data.series.map((p) => ({ ...p, date: dateLabel(p.date) }));

  return (
    <>
      <PageHeader title={data.author} description={`Period ${data.range.from} – ${data.range.to}`}>
        <Link href="/autori" className="text-xs text-[var(--text-secondary)] underline">
          ← Svi autori
        </Link>
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile label="Pregledi" value={num(data.totals.pageviews)} />
        <StatTile label="Jedinstveni" value={num(data.totals.uniqueVisitors)} />
        <StatTile label="Objavljeno" value={num(data.totals.articlesPublished)} unit="tekstova" />
        <StatTile
          label="Prosečno vreme"
          value={data.totals.avgTimeOnPageSec ? duration(data.totals.avgTimeOnPageSec) : '—'}
        />
        <StatTile
          label="Pročitanost"
          value={data.totals.readCompletionRate ? pct(data.totals.readCompletionRate) : '—'}
          hint="75%+ teksta i dovoljno vremena"
        />
      </div>

      <div className="mb-5">
        <Card title="Pregledi kroz vreme">
          <TimeSeries
            data={series}
            series={[
              { key: 'pageviews', label: 'Pregledi' },
              { key: 'uniqueVisitors', label: 'Jedinstveni posetioci' },
            ]}
          />
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Odakle dolazi njegov saobraćaj" subtitle="Ko donosi social, ko Google">
          <Donut data={data.byChannel} labelKey="label" valueKey="pageviews" height={220} />
        </Card>

        <Card title="Po kategorijama">
          <BarList
            data={data.byCategory.slice(0, 10)}
            labelKey="category"
            valueKey="pageviews"
            color="var(--series-3)"
            height={Math.max(200, data.byCategory.slice(0, 10).length * 26)}
          />
        </Card>
      </div>

      <Card title="Najčitaniji tekstovi">
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
            { key: 'category', label: 'Kategorija', render: (r) => r.category || '—' },
            { key: 'publishedAt', label: 'Objavljeno', render: (r) => dateLabel(r.publishedAt) },
            { key: 'pageviewsTotal', label: 'Ukupno', align: 'right' },
            { key: 'pageviews7d', label: '7 dana', align: 'right' },
            {
              key: 'readCompletionRate',
              label: 'Pročitanost',
              align: 'right',
              render: (r) => (r.readCompletionRate ? pct(r.readCompletionRate) : '—'),
            },
          ]}
          rows={data.topArticles}
          initialSort={{ key: 'pageviewsTotal', dir: 'desc' }}
        />
      </Card>
    </>
  );
}
