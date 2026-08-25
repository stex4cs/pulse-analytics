'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Card, StatTile, DataTable, Loading, ErrorNote, Badge, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { TimeSeries, Donut, Funnel } from '@/components/charts';
import { ClickHeatmap, TopSelectors } from '@/components/heatmap';
import { num, pct, duration, dateTimeLabel, hourLabel } from '@/lib/format';

export default function ArticleDetailPage({ params }) {
  const { id } = use(params);
  const [bucket, setBucket] = useState(375);

  const { data, error, isLoading } = useSWR(`/articles/${encodeURIComponent(id)}`, fetcher);
  const { data: heatmap } = useSWR(
    `/articles/${encodeURIComponent(id)}/heatmap?viewport=${bucket}`,
    fetcher,
  );

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const a = data.article;
  const series = data.series.map((p) => ({ ...p, hour: hourLabel(p.hour) }));

  return (
    <>
      <PageHeader
        title={a.title}
        description={[a.author, a.category, a.wordCount ? `${num(a.wordCount)} reči` : null]
          .filter(Boolean).join(' · ')}
      >
        <Link href="/clanci" className="text-xs text-[var(--text-secondary)] underline">← Svi članci</Link>
        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--text-secondary)] underline">
            Otvori tekst ↗
          </a>
        )}
      </PageHeader>

      {a.contentType === 'live-blog' && (
        <div className="mb-4">
          <Note>
            Ovo je <strong>live blog</strong>. Čitaoci ostaju satima, pa se njegovo vreme na stranici
            ne uračunava u proseke ostalih tekstova — inače bi ih izobličilo.
          </Note>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatTile label="Ukupno" value={num(a.pageviewsTotal)} />
        <StatTile label="24h" value={num(a.pageviews24h)} />
        <StatTile label="7 dana" value={num(a.pageviews7d)} />
        <StatTile label="Jedinstveni" value={num(a.uniqueVisitors)} />
        <StatTile
          label="Vreme na stranici"
          value={a.avgTimeOnPageSec ? duration(a.avgTimeOnPageSec) : '—'}
        />
        <StatTile
          label="Pročitanost"
          value={a.readCompletionRate ? pct(a.readCompletionRate) : '—'}
          hint="75%+ i dovoljno vremena"
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Pregledi od objave" subtitle={a.publishedAt ? dateTimeLabel(a.publishedAt) : ''} className="lg:col-span-2">
          <TimeSeries
            data={series}
            xKey="hour"
            series={[{ key: 'pageviews', label: 'Pregledi po satu' }]}
            area
          />
        </Card>

        <Card title="Odakle su došli">
          <Donut data={data.sourceBreakdown} labelKey="label" valueKey="pageviews" height={200} />
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card
          title="Dokle su stigli"
          subtitle="Levak dubine skrola — od 25% do kraja teksta"
        >
          <Funnel steps={data.scrollFunnel} />
          <div className="mt-4">
            <Note>
              Ovaj levak i <strong>pročitanost</strong> zajedno razdvajaju „kliknuo pa odmah izašao”
              od „stvarno pročitao”. Za news portal to je korisnije od bounce rate-a.
            </Note>
          </div>
        </Card>

        <Card
          title="Kako se poredi"
          subtitle={`U odnosu na ${num(data.comparison.peersCount)} tekstova iz iste rubrike (90 dana)`}
        >
          <div className="flex items-baseline gap-3">
            <span className="tabular text-4xl font-semibold text-[var(--text-primary)]">
              {data.comparison.categoryPercentile}.
            </span>
            <span className="text-sm text-[var(--text-secondary)]">percentil</span>
          </div>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Bolji od {data.comparison.categoryPercentile}% tekstova u rubrici.
            Medijana rubrike je <strong className="tabular">{num(data.comparison.categoryMedian)}</strong> pregleda,
            ovaj tekst ima <strong className="tabular">{num(a.pageviewsTotal)}</strong>.
          </p>

          <div className="mt-4 h-2 overflow-hidden rounded bg-[var(--surface-2)]">
            <div
              className="h-full rounded bg-[var(--series-1)]"
              style={{ width: `${data.comparison.categoryPercentile}%` }}
            />
          </div>

          {a.tags?.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-medium uppercase text-[var(--text-muted)]">Tagovi</div>
              <div className="flex flex-wrap gap-1.5">
                {a.tags.map((t) => <Badge key={t}>{t}</Badge>)}
              </div>
            </div>
          )}
        </Card>
      </div>

      {data.abTest && <AbResults test={data.abTest} />}

      <div className="mb-5">
        <Card
          title="Heatmapa klikova"
          subtitle="Koordinate normalizovane po širini ekrana; samo uz consent posetioca"
        >
          <ClickHeatmap data={heatmap} bucket={bucket} onBucketChange={setBucket} pageUrl={a.url} />
        </Card>
      </div>

      {heatmap?.topSelectors?.length > 0 && (
        <Card title="Najklikaniji elementi" subtitle="Isti podatak, bez slike">
          <TopSelectors selectors={heatmap.topSelectors} />
        </Card>
      )}
    </>
  );
}

function AbResults({ test }) {
  const enough = test.variants.every((v) => Number(v.impressions) >= Number(test.minImpressions ?? 1000));
  const winner = test.winner_variant ?? test.winner;

  return (
    <div className="mb-5">
      <Card
        title="A/B test naslova"
        subtitle={`Status: ${test.status}`}
        action={winner ? <Badge tone="good">Pobednik: {winner}</Badge> : <Badge>Bez pobednika</Badge>}
      >
        <DataTable
          columns={[
            {
              key: 'variant',
              label: 'Varijanta',
              render: (r) => (
                <span className="font-medium">
                  {r.variant}{r.isControl ? ' (kontrola)' : ''}
                </span>
              ),
            },
            { key: 'headline', label: 'Naslov', render: (r) => <span className="line-clamp-2">{r.headline}</span> },
            { key: 'impressions', label: 'Prikaza', align: 'right' },
            { key: 'clicks', label: 'Klikova', align: 'right' },
            {
              key: 'ctr',
              label: 'CTR',
              align: 'right',
              render: (r) => (r.impressions ? pct((r.clicks / r.impressions) * 100, 2) : '—'),
            },
            {
              key: 'confidence',
              label: 'Konfidencija',
              align: 'right',
              render: (r) => (r.isControl ? '—'
                : r.confidence ? pct(Number(r.confidence) * 100) : '—'),
            },
          ]}
          rows={test.variants}
          initialSort={{ key: 'impressions', dir: 'desc' }}
        />

        {!enough && (
          <div className="mt-3">
            <Note>
              <strong>Još nema dovoljno podataka.</strong> Pobednik se ne proglašava ispod{' '}
              {num(test.minImpressions ?? 1000)} prikaza po varijanti i 95% konfidencije —
              test bez dovoljnog uzorka je gori od nikakvog testa.
            </Note>
          </div>
        )}
      </Card>
    </div>
  );
}
