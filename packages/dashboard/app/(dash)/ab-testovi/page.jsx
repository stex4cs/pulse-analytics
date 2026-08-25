'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { mutate } from 'swr';
import { fetcher, apiFetch } from '@/lib/api';
import { Card, DataTable, Loading, ErrorNote, Button, Badge, Note } from '@/components/ui';
import { PageHeader } from '@/components/nav';
import { num, pct, dateLabel } from '@/lib/format';

export default function AbTestsPage() {
  const [creating, setCreating] = useState(false);
  const { data, error, isLoading } = useSWR('/ab/tests', fetcher, { refreshInterval: 60_000 });

  if (error) return <ErrorNote error={error} />;

  return (
    <>
      <PageHeader
        title="A/B testovi naslova"
        description="Viši CTR znači više pregleda. Pobednik se proglašava tek kad brojevi to zaista pokazuju."
      >
        <Button variant="primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Odustani' : 'Novi test'}
        </Button>
      </PageHeader>

      <div className="mb-4">
        <Note>
          Prag je <strong>95% konfidencije i minimum 1.000 prikaza po varijanti</strong>. Dok se oba
          uslova ne ispune, Pulse eksplicitno kaže „još nema dovoljno podataka” umesto da ponudi
          lažnog pobednika — odluka na šumu košta više nego čekanje.
        </Note>
      </div>

      {creating && <CreateTestForm onDone={() => { setCreating(false); mutate('/ab/tests'); }} />}

      {isLoading || !data ? <Loading /> : (
        <div className="space-y-4">
          {data.tests.length === 0 && (
            <Card><p className="py-8 text-center text-sm text-[var(--text-muted)]">Još nema testova.</p></Card>
          )}

          {data.tests.map((test) => (
            <TestCard key={test.testId} test={test} />
          ))}
        </div>
      )}
    </>
  );
}

function TestCard({ test }) {
  async function stop(winner) {
    await apiFetch(`/ab/tests/${test.testId}/stop`, {
      method: 'POST',
      body: JSON.stringify(winner ? { winner } : {}),
    });
    mutate('/ab/tests');
  }

  const tone = test.winner ? 'good' : test.hasEnoughData ? 'warning' : 'neutral';

  return (
    <Card
      title={test.articleTitle ?? `Članak ${test.articleId}`}
      subtitle={`${test.testId} · pokrenut ${dateLabel(test.createdAt)}`}
      action={
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{test.winner ? `Pobednik: ${test.winner}` : test.statusText}</Badge>
          {test.status === 'running' && (
            <>
              {test.winner && (
                <Button variant="primary" onClick={() => stop(test.winner)}>
                  Promoviši {test.winner}
                </Button>
              )}
              <Button onClick={() => stop(null)}>Zaustavi</Button>
            </>
          )}
          <Link href={`/clanci/${test.articleId}`} className="text-xs text-[var(--text-secondary)] underline">
            Članak →
          </Link>
        </div>
      }
    >
      <DataTable
        columns={[
          {
            key: 'variant',
            label: 'Varijanta',
            render: (r) => (
              <span className="font-medium">
                {r.variant}{r.isControl ? ' (kontrola)' : ''}
                {test.winner === r.variant && ' 🏆'}
              </span>
            ),
          },
          { key: 'headline', label: 'Naslov', render: (r) => <span className="line-clamp-2">{r.headline}</span> },
          { key: 'impressions', label: 'Prikaza', align: 'right' },
          { key: 'clicks', label: 'Klikova', align: 'right' },
          { key: 'ctr', label: 'CTR', align: 'right', render: (r) => pct(r.ctr, 2) },
          {
            key: 'confidence',
            label: 'Konfidencija',
            align: 'right',
            render: (r) => (r.isControl ? '—' : r.confidence ? pct(Number(r.confidence) * 100) : '—'),
          },
        ]}
        rows={test.variants}
        initialSort={{ key: 'impressions', dir: 'desc' }}
      />

      {!test.hasEnoughData && test.impressionsNeeded > 0 && (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Nedostaje još <strong className="tabular">{num(test.impressionsNeeded)}</strong> prikaza
          na najslabijoj varijanti pre nego što rezultat bude upotrebljiv.
        </p>
      )}
    </Card>
  );
}

function CreateTestForm({ onDone }) {
  const [articleId, setArticleId] = useState('');
  const [headlines, setHeadlines] = useState(['', '']);
  const [autoPromote, setAutoPromote] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/ab/tests', {
        method: 'POST',
        body: JSON.stringify({
          articleId,
          autoPromote,
          variants: headlines
            .filter((h) => h.trim())
            .map((headline, i) => ({ variant: String.fromCharCode(65 + i), headline })),
        }),
      });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5">
      <Card title="Novi A/B test">
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">ID članka</span>
            <input
              required
              value={articleId}
              onChange={(e) => setArticleId(e.target.value)}
              placeholder="76177"
              className="w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
            />
          </label>

          {headlines.map((h, i) => (
            <label key={i} className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Varijanta {String.fromCharCode(65 + i)}{i === 0 ? ' (kontrola)' : ''}
              </span>
              <input
                required={i < 2}
                value={h}
                onChange={(e) => setHeadlines((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-1)]"
              />
            </label>
          ))}

          {headlines.length < 3 && (
            <Button onClick={() => setHeadlines((p) => [...p, ''])}>+ Dodaj treću varijantu</Button>
          )}

          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={autoPromote}
              onChange={(e) => setAutoPromote(e.target.checked)}
              className="accent-[var(--series-1)]"
            />
            Automatski prebaci sav saobraćaj na pobednika kad prag bude ispunjen
          </label>

          {error && <ErrorNote error={{ message: error }} />}

          <div className="flex gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Pokrećem…' : 'Pokreni test'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
