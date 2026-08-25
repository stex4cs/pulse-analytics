'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher, downloadCsv } from '@/lib/api';
import { Card, DataTable, StatTile, RangePicker, Loading, ErrorNote, Button, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { GeoMap } from '@/components/map';
import { BarList, HeatmapTable } from '@/components/charts';
import { COUNTRY_NAMES, COUNTRY_REGIONS } from '@/lib/world-map';
import { num, pct } from '@/lib/format';

const SOURCE_OPTIONS = [
  { value: '', label: 'Svi kanali' },
  { value: 'search_organic', label: 'Organska pretraga' },
  { value: 'google_discover', label: 'Discover' },
  { value: 'social_meta', label: 'Facebook / IG' },
  { value: 'direct', label: 'Direktan' },
  { value: 'paid', label: 'Plaćeni' },
];

export default function GeoPage() {
  const [days, setDays] = useState(30);
  const [source, setSource] = useState('');
  const [country, setCountry] = useState(null);

  const q = new URLSearchParams({ days: String(days) });
  if (source) q.set('source', source);

  const cityQ = new URLSearchParams(q);
  cityQ.set('limit', '300');
  if (country) cityQ.set('country', country);

  const { data, error, isLoading } = useSWR(`/geo?${q}`, fetcher);
  const { data: cityData } = useSWR(`/geo/cities?${cityQ}`, fetcher);
  const { data: channels } = useSWR(`/geo/channels?days=${days}&limit=12`, fetcher);

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  const countries = data.countries.map((c) => ({
    ...c,
    name: COUNTRY_NAMES[c.country] ?? c.country,
    region: COUNTRY_REGIONS[c.country] ?? 'Ostalo',
  }));

  const cities = cityData?.cities ?? [];
  const home = countries.find((c) => c.country === 'RS');
  const region = countries.filter((c) => ['BA', 'ME', 'HR', 'MK', 'SI', 'XK'].includes(c.country));
  const regionPv = region.reduce((s, c) => s + c.pageviews, 0);
  const diaspora = countries.filter((c) => !['RS', 'BA', 'ME', 'HR', 'MK', 'SI', 'XK'].includes(c.country));
  const diasporaPv = diaspora.reduce((s, c) => s + c.pageviews, 0);

  return (
    <>
      <PageHeader
        title="Geografija"
        description="Odakle čitaoci dolaze — i sa kog kanala u kojoj zemlji."
      >
        <RangePicker value={days} onChange={setDays} />
        <Button onClick={() => downloadCsv(`/geo/export.csv?days=${days}`, `pulse-geografija-${days}d.csv`)}>
          CSV
        </Button>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">Kanal:</span>
        <div className="inline-flex flex-wrap rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-0.5">
          {SOURCE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSource(o.value)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors
                ${source === o.value
                ? 'bg-[var(--series-1)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ukupno pregleda" value={num(data.total)} />
        <StatTile
          label="Srbija"
          value={home ? pct(home.share) : '—'}
          hint={home ? `${num(home.pageviews)} pregleda` : ''}
        />
        <StatTile
          label="Region"
          value={data.total ? pct((regionPv / data.total) * 100) : '—'}
          hint="BA, ME, HR, MK, SI, XK"
        />
        <StatTile
          label="Dijaspora i ostalo"
          value={data.total ? pct((diasporaPv / data.total) * 100) : '—'}
          hint={`${diaspora.length} zemalja`}
        />
      </div>

      <div className="mb-5">
        <Card
          title="Mapa"
          subtitle={country
            ? `Gradovi prikazani samo za: ${COUNTRY_NAMES[country] ?? country}`
            : 'Boja države = pregledi, krug = grad'}
        >
          <GeoMap
            countries={countries}
            cities={cities}
            selectedCountry={country}
            onSelectCountry={setCountry}
          />
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <Card title="Države" subtitle={`${countries.length} zemalja u periodu`}>
          <DataTable
            columns={[
              { key: 'name', label: 'Država' },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
              { key: 'share', label: 'Udeo', align: 'right', render: (r) => pct(r.share) },
            ]}
            rows={countries.map((c) => ({ ...c, id: c.country }))}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
            onRowClick={(r) => setCountry(r.country === country ? null : r.country)}
          />
        </Card>

        <Card
          title="Gradovi"
          subtitle={country ? COUNTRY_NAMES[country] ?? country : 'Svi'}
        >
          {cities.length ? (
            <BarList
              data={cities.slice(0, 14).map((c) => ({ ...c, label: `${c.city} (${c.country})` }))}
              labelKey="label"
              valueKey="pageviews"
              color="var(--series-2)"
              height={Math.max(220, Math.min(14, cities.length) * 26)}
            />
          ) : (
            <p className="py-16 text-center text-sm text-[var(--text-muted)]">
              Nema gradova za izabrani filter.
            </p>
          )}
        </Card>
      </div>

      <div className="mb-5">
        <Card title="Gradovi — pun spisak">
          <DataTable
            columns={[
              { key: 'city', label: 'Grad' },
              { key: 'country', label: 'Država', render: (r) => COUNTRY_NAMES[r.country] ?? r.country },
              { key: 'pageviews', label: 'Pregledi', align: 'right' },
              { key: 'uniqueVisitors', label: 'Jedinstveni', align: 'right' },
            ]}
            rows={cities.map((c, i) => ({ ...c, id: `${c.country}-${c.city}-${i}` }))}
            initialSort={{ key: 'pageviews', dir: 'desc' }}
            empty="Nema podataka o gradovima. Proverite da li je GeoLite2 baza na mestu."
          />
          <div className="mt-3">
            <Note>
              Grad se izvodi iz IP adrese, koja se <strong>nikad ne čuva</strong> — u bazi
              ostaje samo rezultat i koordinate centra grada. Za deo posetilaca (VPN, mobilne
              mreže, korporativni izlazi) grad je netačan ili ga uopšte nema.
            </Note>
          </div>
        </Card>
      </div>

      {channels?.rows?.length > 0 && (
        <Card
          title="Kanal × država"
          subtitle="Isti saobraćaj presečen drugačije — pokazuje da dijaspora ne dolazi istim putem kao domaći čitaoci"
        >
          <HeatmapTable
            rows={channels.rows.map((r) => ({ ...r, category: COUNTRY_NAMES[r.country] ?? r.country }))}
            columns={channels.sources}
            rowLabel="Država"
            getValue={(r, c) => r.bySource[c]}
          />
        </Card>
      )}
    </>
  );
}
