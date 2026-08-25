'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher, downloadCsv } from '@/lib/api';
import { Card, DataTable, Loading, ErrorNote, Button, Badge } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { pct, duration, dateLabel } from '@/lib/format';

const CONTENT_TYPES = [
  { value: '', label: 'Sve' },
  { value: 'news', label: 'Vest' },
  { value: 'live-blog', label: 'Live blog' },
  { value: 'video', label: 'Video' },
  { value: 'column', label: 'Kolumna' },
];

export default function ArticlesPage() {
  const [query, setQuery] = useState('');
  const [contentType, setContentType] = useState('');

  const params = new URLSearchParams({ limit: '200' });
  if (query) params.set('q', query);
  if (contentType) params.set('contentType', contentType);

  const { data, error, isLoading } = useSWR(`/articles?${params}`, fetcher);

  if (error) return <ErrorNote error={error} />;

  return (
    <>
      <PageHeader
        title="Članci"
        description="Svi tekstovi sa merljivim saobraćajem. Klik otvara detaljan pregled sa levkom čitanja i heatmapom."
      >
        <Button onClick={() => downloadCsv('/articles/export.csv', 'pulse-clanci.csv')}>CSV</Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Pretraga po naslovu…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64 rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
        />
        <div className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {CONTENT_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setContentType(t.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${contentType === t.value
                ? 'bg-[var(--series-1)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? <Loading /> : (
        <Card>
          <DataTable
            columns={[
              {
                key: 'title',
                label: 'Naslov',
                render: (r) => (
                  <Link href={`/clanci/${r.articleId}`} className="line-clamp-2 font-medium hover:underline">
                    {r.title}
                  </Link>
                ),
              },
              { key: 'author', label: 'Autor', render: (r) => r.author || '—' },
              {
                key: 'contentType',
                label: 'Tip',
                render: (r) => (r.contentType === 'live-blog'
                  ? <Badge tone="warning">live blog</Badge>
                  : <span className="text-[var(--text-muted)]">{r.contentType ?? '—'}</span>),
              },
              { key: 'publishedAt', label: 'Objavljeno', render: (r) => dateLabel(r.publishedAt) },
              { key: 'pageviews24h', label: '24h', align: 'right' },
              { key: 'pageviewsTotal', label: 'Ukupno', align: 'right' },
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
            ]}
            rows={data.articles}
            initialSort={{ key: 'pageviews24h', dir: 'desc' }}
          />
        </Card>
      )}
    </>
  );
}
