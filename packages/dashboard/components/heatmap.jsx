'use client';

/**
 * Heatmapa klikova (sekcija 9.1).
 *
 * Canvas overlay: svaka ćelija je radijalni gradijent čiji intenzitet nosi
 * broj klikova, pa se preko svega prevlači sekvencijalna paleta. Koordinate
 * su normalizovane na viewport bucket, pa se crtaju u toj širini i skaliraju
 * na dostupan prostor.
 */

import { useEffect, useRef, useState } from 'react';
import { num } from '@/lib/format';

const BUCKETS = [320, 375, 414, 768, 1024, 1440, 1920];

export function ClickHeatmap({ data, onBucketChange, bucket, pageUrl }) {
  const canvasRef = useRef(null);
  const [height, setHeight] = useState(1200);

  useEffect(() => {
    if (!data?.cells?.length) return;
    const maxY = data.cells.reduce((m, c) => Math.max(m, c.y), 0);
    setHeight(Math.max(600, maxY + 200));
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.cells?.length) return;

    const ctx = canvas.getContext('2d');
    const width = bucket;
    canvas.width = width;
    canvas.height = height;
    ctx.clearRect(0, 0, width, height);

    // 1) intenzitet u alfa kanalu
    const radius = 22;
    for (const cell of data.cells) {
      const alpha = Math.min(1, 0.15 + cell.intensity * 0.85);
      const gradient = ctx.createRadialGradient(cell.x, cell.y, 0, cell.x, cell.y, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cell.x, cell.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2) alfa -> sekvencijalna paleta (jedna nijansa, svetlo -> tamno)
    const image = ctx.getImageData(0, 0, width, height);
    const px = image.data;
    const ramp = [
      [205, 226, 251], [134, 182, 239], [57, 135, 229], [28, 92, 171], [13, 54, 107],
    ];

    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a === 0) continue;
      const step = Math.min(ramp.length - 1, Math.floor((a / 255) * ramp.length));
      const [r, g, b] = ramp[step];
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = Math.min(220, a + 40);
    }
    ctx.putImageData(image, 0, 0);
  }, [data, bucket, height]);

  if (!data) return null;

  if (!data.available) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-4 py-8 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          Heatmapa se ne prikazuje ispod {num(data.required)} pregleda — ispod toga je šum, ne obrazac.
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Trenutno: {num(data.pageviews)} pregleda.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">Širina ekrana:</span>
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => onBucketChange(b)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors
              ${bucket === b
              ? 'bg-[var(--series-1)] text-white'
              : 'border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]'}`}
          >
            {b}px
          </button>
        ))}
        {pageUrl && (
          <a
            href={pageUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs text-[var(--text-secondary)] underline"
          >
            Otvori stranicu ↗
          </a>
        )}
      </div>

      <div className="max-h-[600px] overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)]">
        <canvas
          ref={canvasRef}
          className="block"
          style={{ width: '100%', maxWidth: bucket, margin: '0 auto' }}
        />
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-[var(--text-muted)]">
        <span>Manje klikova</span>
        <span className="flex h-2 w-32 overflow-hidden rounded">
          {['var(--seq-100)', 'var(--seq-250)', 'var(--seq-400)', 'var(--seq-550)', 'var(--seq-700)'].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </span>
        <span>Više klikova</span>
        <span className="ml-auto">Maksimum u ćeliji: {num(data.maxClicks)}</span>
      </div>
    </div>
  );
}

/** Tabelarni prikaz istog podatka - najklikanije mete, po selektoru. */
export function TopSelectors({ selectors }) {
  if (!selectors?.length) return null;
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="border-b border-[var(--border)] px-3 py-2 text-left text-xs font-medium uppercase text-[var(--text-muted)]">
            Element
          </th>
          <th className="border-b border-[var(--border)] px-3 py-2 text-right text-xs font-medium uppercase text-[var(--text-muted)]">
            Klikova
          </th>
        </tr>
      </thead>
      <tbody>
        {selectors.map((s) => (
          <tr key={s.selector} className="border-b border-[var(--border)] last:border-0">
            <td className="px-3 py-1.5 font-mono text-xs text-[var(--text-secondary)]">{s.selector}</td>
            <td className="tabular px-3 py-1.5 text-right text-[var(--text-primary)]">{num(s.clicks)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
