'use client';

import useSWR, { mutate } from 'swr';
import { fetcher, apiFetch } from '@/lib/api';
import { Card, DataTable, Loading, ErrorNote, Badge, Button, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { num, dateTimeLabel } from '@/lib/format';

export default function AlertsPage() {
  const { data, error, isLoading } = useSWR('/alerts', fetcher, { refreshInterval: 30_000 });

  if (error) return <ErrorNote error={error} />;
  if (isLoading || !data) return <Loading />;

  async function resolve(id) {
    await apiFetch(`/alerts/${id}/resolve`, { method: 'POST' });
    mutate('/alerts');
  }

  const active = data.alerts.filter((a) => !a.resolved_at);

  return (
    <>
      <PageHeader
        title="Spike alerti"
        description="Nagli skokovi saobraćaja u odnosu na uobičajeno za taj dan i to doba dana."
      />

      <div className="mb-4">
        <Note>
          Alert se okida kad pregledi u minutu pređu <strong>3× prosek</strong> za isti dan u nedelji i isti
          sat, izračunat iz poslednje četiri nedelje. Uz alert ide i šta ga vuče — da bi odluka
          tokom utakmice bila konkretna, a ne nagađanje.
        </Note>
      </div>

      {active.length > 0 && (
        <div className="mb-5 space-y-2">
          {active.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--status-warning)]/50 bg-[var(--status-warning)]/10 px-4 py-3"
            >
              <span className="text-sm font-semibold text-[var(--status-warning)]">⚡ Aktivan</span>
              <span className="tabular text-sm text-[var(--text-primary)]">
                {num(a.pageviews_per_min)} /min · {Number(a.multiplier).toFixed(1)}×
              </span>
              <span className="text-sm text-[var(--text-secondary)]">
                Vuče: <strong className="text-[var(--text-primary)]">{a.driver_value}</strong>
              </span>
              <span className="text-xs text-[var(--text-muted)]">{dateTimeLabel(a.detected_at)}</span>
              <div className="ml-auto">
                <Button onClick={() => resolve(a.id)}>Označi kao rešeno</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Card title="Istorija alerta">
        <DataTable
          columns={[
            { key: 'detected_at', label: 'Vreme', render: (r) => dateTimeLabel(r.detected_at) },
            { key: 'pageviews_per_min', label: 'Pregleda/min', align: 'right' },
            {
              key: 'baseline_per_min',
              label: 'Prosek',
              align: 'right',
              render: (r) => Number(r.baseline_per_min).toFixed(1),
            },
            {
              key: 'multiplier',
              label: 'Faktor',
              align: 'right',
              render: (r) => `${Number(r.multiplier).toFixed(1)}×`,
            },
            { key: 'driver_type', label: 'Tip', render: (r) => <Badge>{r.driver_type}</Badge> },
            { key: 'driver_value', label: 'Šta vuče', render: (r) => <span className="line-clamp-1">{r.driver_value}</span> },
            {
              key: 'notified',
              label: 'Slack',
              align: 'right',
              render: (r) => (r.notified ? '✓' : '—'),
            },
          ]}
          rows={data.alerts.map((a) => ({ ...a, id: a.id }))}
          initialSort={{ key: 'detected_at', dir: 'desc' }}
          empty="Još nije bilo spike-ova. To je dobra vest."
        />
      </Card>
    </>
  );
}
