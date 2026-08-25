'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher, downloadCsv } from '@/lib/api';
import { Card, DataTable, RangePicker, Loading, ErrorNote, Button, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { BarList } from '@/components/charts';
import { pct, duration, trendClass, trendArrow } from '@/lib/format';

export default function AuthorsPage() {
  const [days, setDays] = useState(7);
  const { data, error, isLoading } = useSWR(`/authors?days=${days}`, fetcher);

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const top = data.authors.slice(0, 12);

  return (
    <>
      <PageHeader
        title="Autori"
        description="Rangiranje po ukupnim pregledima, proseku po tekstu i stvarnoj pročitanosti."
      >
        <RangePicker value={days} onChange={setDays} />
        <Button onClick={() => downloadCsv(`/authors/export.csv?days=${days}`, `pulse-autori-${days}d.csv`)}>
          CSV
        </Button>
      </PageHeader>

      <div className="mb-4">
        <Note>
          <strong>Prosek po članku</strong> je fer prema autorima koji pišu manje ali kvalitetnije.
          <strong> Pročitanost</strong> broji samo one koji su stigli do 75%+ teksta i proveli vreme
          srazmerno njegovoj dužini — zato je niža od bilo čega što pokazuje GA4.
        </Note>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Pregledi" subtitle={`Period ${data.range.from} – ${data.range.to}`}>
          <BarList data={top} labelKey="author" valueKey="pageviews" height={Math.max(220, top.length * 26)} />
        </Card>

        <Card title="Prosek po članku" subtitle="Ko donosi najviše po objavljenom tekstu">
          <BarList
            data={[...top].sort((a, b) => b.avgPageviewsPerArticle - a.avgPageviewsPerArticle).slice(0, 12)}
            labelKey="author"
            valueKey="avgPageviewsPerArticle"
            color="var(--series-2)"
            height={Math.max(220, top.length * 26)}
          />
        </Card>
      </div>

      <Card title="Leaderboard" subtitle="Klik na autora otvara detaljan pregled">
        <DataTable
          columns={[
            {
              key: 'author',
              label: 'Autor',
              render: (r) => (
                <Link href={`/autori/${encodeURIComponent(r.author)}`} className="font-medium hover:underline">
                  {r.author}
                </Link>
              ),
            },
            { key: 'pageviews', label: 'Pregledi', align: 'right' },
            { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
            { key: 'articlesPublished', label: 'Članaka', align: 'right' },
            { key: 'avgPageviewsPerArticle', label: 'Prosek/članak', align: 'right' },
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
          rows={data.authors}
          initialSort={{ key: 'pageviews', dir: 'desc' }}
          empty="Nema podataka o autorima. Proverite da li sajt šalje `author` u window.pulseMeta."
        />
      </Card>
    </>
  );
}
