'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, downloadCsv } from '@/lib/api';
import { Card, DataTable, StatTile, RangePicker, Loading, ErrorNote, Button, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { TimeSeries, HeatmapTable, Donut } from '@/components/charts';
import { num, pct, duration, dateLabel, trendClass, trendArrow } from '@/lib/format';

export default function ChannelsPage() {
  const [days, setDays] = useState(30);

  const { data, error, isLoading } = useSWR(`/sources?days=${days}`, fetcher);
  const { data: series } = useSWR(`/sources/timeseries?days=${days}`, fetcher);
  const { data: devices } = useSWR(`/sources/devices?days=${days}`, fetcher);
  const { data: discover } = useSWR(`/sources/discover?days=${days}`, fetcher);
  const { data: campaigns } = useSWR(`/sources/campaigns?days=${days}`, fetcher);

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const direct = data.sources.find((s) => s.source === 'direct');
  const disc = data.sources.find((s) => s.source === 'google_discover');

  const seriesData = (series?.points ?? []).map((p) => ({ ...p, date: dateLabel(p.date) }));
  const topSources = (series?.sources ?? []).slice(0, 6);

  return (
    <>
      <PageHeader
        title="Kanali"
        description="Odakle stvarno dolazi saobraćaj — sa Google Discover-om izdvojenim iz organske pretrage."
      >
        <RangePicker value={days} onChange={setDays} />
        <Button onClick={() => downloadCsv(`/sources/export.csv?days=${days}`, `pulse-kanali-${days}d.csv`)}>
          CSV
        </Button>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ukupno pregleda" value={num(data.total)} />
        <StatTile
          label="Google Discover"
          value={disc ? pct(disc.share) : '—'}
          hint={disc ? `${num(disc.pageviews)} pregleda` : 'nema podataka'}
        />
        <StatTile
          label="Direktan"
          value={direct ? pct(direct.share) : '—'}
          hint="deo ovoga su aplikacije i email"
        />
        <StatTile
          label="Kanala u igri"
          value={num(data.sources.length)}
        />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Card title="Kretanje po kanalu" className="lg:col-span-2">
          {seriesData.length ? (
            <TimeSeries
              data={seriesData}
              series={topSources.map((s) => ({ key: s.source, label: s.label }))}
            />
          ) : <Loading />}
        </Card>

        <Card title="Udeo kanala">
          <Donut data={data.sources} labelKey="label" valueKey="pageviews" height={220} />
        </Card>
      </div>

      <div className="mb-5">
        <Card title="Kanali — pun pregled">
          <DataTable
            columns={[
              { key: 'label', label: 'Kanal' },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
              { key: 'sessions', label: 'Sesija', align: 'right' },
              {
                key: 'avgSessionPages',
                label: 'Str./sesiji',
                align: 'right',
                render: (r) => (r.avgSessionPages ? r.avgSessionPages.toFixed(2) : '—'),
              },
              {
                key: 'bounceRate',
                label: 'Bounce',
                align: 'right',
                render: (r) => (r.bounceRate ? pct(r.bounceRate) : '—'),
              },
              {
                key: 'avgSessionSec',
                label: 'Trajanje',
                align: 'right',
                render: (r) => (r.avgSessionSec ? duration(r.avgSessionSec) : '—'),
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
            rows={data.sources}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
          />
          <div className="mt-3">
            <Note>{data.directNote}</Note>
          </div>
        </Card>
      </div>

      {discover?.series?.length > 0 && (
        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          <Card title="Google Discover" subtitle="Dolazi u talasima — zato ima svoj grafik">
            <TimeSeries
              data={discover.series.map((p) => ({ ...p, date: dateLabel(p.date) }))}
              series={[{ key: 'pageviews', label: 'Discover pregledi' }]}
              area
            />
            <div className="mt-3">
              <Note>{discover.note}</Note>
            </div>
          </Card>

          <Card title="Kako se Discover ponaša naspram ostalih" subtitle="Ista metrika, četiri kanala">
            <DataTable
              columns={[
                { key: 'label', label: 'Kanal' },
                {
                  key: 'bounceRate',
                  label: 'Bounce',
                  align: 'right',
                  render: (r) => (r.bounceRate ? pct(r.bounceRate) : '—'),
                },
                {
                  key: 'avgSessionPages',
                  label: 'Str./sesiji',
                  align: 'right',
                  render: (r) => (r.avgSessionPages ? r.avgSessionPages.toFixed(2) : '—'),
                },
                {
                  key: 'avgSessionSec',
                  label: 'Trajanje',
                  align: 'right',
                  render: (r) => (r.avgSessionSec ? duration(r.avgSessionSec) : '—'),
                },
              ]}
              rows={discover.comparison}
              initialSort={{ key: 'bounceRate', dir: 'desc' }}
            />
          </Card>
        </div>
      )}

      {devices?.rows?.length > 0 && (
        <div className="mb-5">
          <Card title="Kanal × uređaj">
            <HeatmapTable
              rows={devices.rows}
              columns={devices.devices}
              rowLabel="Kanal"
              getValue={(r, c) => r.byDevice[c]}
            />
          </Card>
        </div>
      )}

      {campaigns?.campaigns?.length > 0 && (
        <Card title="UTM kampanje" subtitle="Plaćeni i tagovani saobraćaj">
          <DataTable
            columns={[
              { key: 'utmCampaign', label: 'Kampanja' },
              { key: 'utmSource', label: 'Izvor' },
              { key: 'utmMedium', label: 'Medium' },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'sessions', label: 'Sesija', align: 'right' },
              {
                key: 'pagesPerSession',
                label: 'Str./sesiji',
                align: 'right',
                render: (r) => r.pagesPerSession.toFixed(2),
              },
            ]}
            rows={campaigns.campaigns}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
          />
        </Card>
      )}
    </>
  );
}
