'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Card, DataTable, RangePicker, Loading, ErrorNote, Badge, Note, Button } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { BarList, TimeSeries, Donut } from '@/components/charts';
import { num, dateLabel } from '@/lib/format';

export default function TagsPage() {
  const [days, setDays] = useState(30);
  const [openTag, setOpenTag] = useState(null);

  const { data: trending } = useSWR('/tags/trending?limit=20', fetcher, { refreshInterval: 120_000 });
  const { data, error, isLoading } = useSWR(`/tags?days=${days}`, fetcher);
  const { data: detail } = useSWR(
    openTag ? `/tags/${encodeURIComponent(openTag)}?days=${days}` : null,
    fetcher,
  );
  // Odakle dolazi saobracaj za temu - autori i kategorije su to imali, tagovi nisu
  const { data: tagChannels } = useSWR(
    openTag ? `/channels?dimension=tag&days=${days}&entity=${encodeURIComponent(openTag)}` : null,
    fetcher,
  );

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  return (
    <>
      <PageHeader
        title="Tagovi"
        description="Šta je u porastu upravo sada i o čemu se dugoročno isplati pisati."
      >
        <RangePicker value={days} onChange={setDays} />
      </PageHeader>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card
          title="U porastu (24h)"
          subtitle="Skor = odnos poslednjeg sata prema proseku, prigušen logaritmom"
        >
          {trending?.tags?.length ? (
            <>
              <BarList
                data={trending.tags.slice(0, 10)}
                labelKey="tag"
                valueKey="trendingScore"
                color="var(--series-2)"
                height={Math.max(200, trending.tags.slice(0, 10).length * 26)}
              />
              <div className="mt-3">
                <Note>
                  Logaritamski faktor sprečava da tekst sa 5 → 20 pregleda nadmaši onaj sa
                  5.000 → 12.000. Visok skor znači stvarni talas, ne statističku buku.
                </Note>
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-sm text-[var(--text-muted)]">
              Trenutno nijedan tag nije u porastu.
            </p>
          )}
        </Card>

        <Card
          title={openTag ? `Tag: ${openTag}` : 'Detalj taga'}
          subtitle={openTag ? `Period ${days} dana` : 'Kliknite tag u tabeli ispod'}
          action={openTag && <Button onClick={() => setOpenTag(null)}>Zatvori</Button>}
        >
          {openTag && detail ? (
            <TimeSeries
              data={detail.series.map((p) => ({ ...p, date: dateLabel(p.date) }))}
              series={[{ key: 'pageviews', label: `Pregledi — ${openTag}` }]}
              area
            />
          ) : (
            <p className="py-16 text-center text-sm text-[var(--text-muted)]">
              Izaberite tag da vidite kretanje kroz vreme i tekstove koji ga nose.
            </p>
          )}
        </Card>
      </div>

      <div className="mb-5">
        <Card title="Svi tagovi" subtitle={`Period ${data.range.from} – ${data.range.to}`}>
          <DataTable
            columns={[
              { key: 'tag', label: 'Tag', render: (r) => <span className="font-medium">{r.tag}</span> },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
              { key: 'articles', label: 'Tekstova', align: 'right' },
              {
                key: 'trendingScore',
                label: 'Trending',
                align: 'right',
                render: (r) => (r.trendingScore > 2
                  ? <Badge tone="warning">{r.trendingScore.toFixed(1)}</Badge>
                  : <span className="text-[var(--text-muted)]">{r.trendingScore.toFixed(1)}</span>),
              },
            ]}
            rows={data.tags}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
            onRowClick={(r) => setOpenTag(r.tag)}
          />
        </Card>
      </div>

      {openTag && tagChannels?.rows?.length > 0 && (
        <div className="mb-5">
          <Card
            title={`Odakle dolaze klikovi za „${openTag}”`}
            subtitle="Poredi se sa prosekom sajta u redu ispod grafika"
          >
            <Donut
              data={tagChannels.rows[0]
                ? Object.entries(tagChannels.rows[0].bySource)
                  .map(([source, pageviews]) => ({
                    label: tagChannels.sources.find((s) => s.source === source)?.label ?? source,
                    pageviews,
                  }))
                  .sort((a, b) => b.pageviews - a.pageviews)
                : []}
              labelKey="label"
              valueKey="pageviews"
              height={220}
            />
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>Prosek sajta:</span>
              {tagChannels.sources.slice(0, 5).map((s) => (
                <span key={s.source}>{s.label} {s.share}%</span>
              ))}
            </div>
          </Card>
        </div>
      )}

      {openTag && detail?.articles?.length > 0 && (
        <Card title={`Tekstovi sa tagom „${openTag}”`} subtitle={`Ukupno ${num(detail.totals.pageviews)} pregleda`}>
          <DataTable
            columns={[
              { key: 'title', label: 'Naslov', render: (r) => <span className="line-clamp-2">{r.title}</span> },
              { key: 'author', label: 'Autor', render: (r) => r.author || '—' },
              { key: 'publishedAt', label: 'Objavljeno', render: (r) => dateLabel(r.publishedAt) },
              { key: 'pageviewsTotal', label: 'Ukupno', align: 'right' },
              { key: 'pageviews7d', label: '7 dana', align: 'right' },
            ]}
            rows={detail.articles}
            initialSort={{ key: 'pageviewsTotal', dir: 'desc' }}
          />
        </Card>
      )}
    </>
  );
}
