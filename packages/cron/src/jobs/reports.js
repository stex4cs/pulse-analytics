/**
 * Zakazani email izvestaji (sekcija 10.7).
 *
 * Nedeljni izvestaj ide ponedeljkom, mesecni prvog u mesecu. Autor dobija
 * samo svoje brojeve - ista pravila vidljivosti kao u dashboard-u (sekcija 11).
 */
import nodemailer from 'nodemailer';
import { config, pgQuery, createLogger } from '@pulse/shared';

const log = createLogger('reports');

let transport = null;
function getTransport() {
  if (transport) return transport;
  if (!config.smtp.host) return null;
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
  });
  return transport;
}

const fmt = (n) => new Intl.NumberFormat('sr-RS').format(Math.round(Number(n) || 0));

function periodBounds(reportType, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  if (reportType === 'weekly') start.setUTCDate(start.getUTCDate() - 7);
  else start.setUTCMonth(start.getUTCMonth() - 1);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function table(headers, rows) {
  const th = headers.map((h) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #e5e7eb;font-size:12px;color:#6b7280;text-transform:uppercase">${h}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;${i === 0 ? '' : 'text-align:right;font-variant-numeric:tabular-nums'}">${c}</td>`).join('')}</tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${th ? `<thead><tr>${th}</tr></thead>` : ''}<tbody>${tr}</tbody></table>`;
}

async function buildOverviewReport(site, from, to, authorSlug) {
  const authorFilter = authorSlug ? 'AND author = $4' : '';
  const params = authorSlug ? [site, from, to, authorSlug] : [site, from, to];

  const totals = await pgQuery(
    `SELECT coalesce(sum(pageviews),0) AS pageviews, coalesce(max(unique_visitors),0) AS unique_visitors
       FROM author_stats
      WHERE site=$1 AND period_type='day' AND period_start >= $2::date AND period_start < $3::date ${authorFilter}`,
    params,
  );

  const authors = await pgQuery(
    `SELECT author, sum(pageviews) AS pageviews, sum(articles_published) AS articles,
            round(avg(nullif(read_completion_rate,0))::numeric, 1) AS read_rate
       FROM author_stats
      WHERE site=$1 AND period_type='day' AND period_start >= $2::date AND period_start < $3::date ${authorFilter}
      GROUP BY author ORDER BY pageviews DESC LIMIT 10`,
    params,
  );

  const sources = await pgQuery(
    `SELECT traffic_source, sum(pageviews) AS pageviews
       FROM source_stats
      WHERE site=$1 AND period_type='day' AND period_start >= $2::date AND period_start < $3::date
      GROUP BY traffic_source ORDER BY pageviews DESC LIMIT 8`,
    [site, from, to],
  );

  const articles = await pgQuery(
    `SELECT title, article_id, author, pageviews_7d
       FROM article_stats
      WHERE site=$1 AND published_at >= $2::date ${authorSlug ? 'AND author = $4' : ''}
      ORDER BY pageviews_7d DESC LIMIT 10`,
    authorSlug ? [site, from, to, authorSlug] : [site, from, to],
  );

  const t = totals[0] ?? { pageviews: 0, unique_visitors: 0 };

  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:720px;margin:0 auto;color:#111827">
    <h1 style="font-size:20px;margin:0 0 4px">Pulse izveštaj — tvarenasport.${site}</h1>
    <p style="color:#6b7280;margin:0 0 20px;font-size:13px">${from} do ${to}</p>

    <div style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:24px">
      <span style="font-size:28px;font-weight:700">${fmt(t.pageviews)}</span>
      <span style="color:#6b7280;font-size:13px"> pregleda</span>
    </div>

    <h2 style="font-size:15px;margin:24px 0 8px">Autori</h2>
    ${table(['Autor', 'Pregledi', 'Članaka', 'Pročitanost %'],
      authors.map((a) => [a.author, fmt(a.pageviews), fmt(a.articles), a.read_rate ?? '—']))}

    <h2 style="font-size:15px;margin:24px 0 8px">Kanali</h2>
    ${table(['Kanal', 'Pregledi'], sources.map((s) => [s.traffic_source, fmt(s.pageviews)]))}

    <h2 style="font-size:15px;margin:24px 0 8px">Najčitaniji tekstovi</h2>
    ${table(['Naslov', 'Pregledi (7d)'],
      articles.map((a) => [a.title ?? a.article_id, fmt(a.pageviews_7d)]))}

    <p style="color:#9ca3af;font-size:12px;margin-top:32px">
      Pulse — first-party analitika. Vremena su u UTC.
    </p>
  </div>`;
}

export async function sendScheduledReports(reportType) {
  const mailer = getTransport();
  const due = await pgQuery(
    `SELECT r.*, u.email, u.name, u.role, u.author_slug
       FROM scheduled_reports r
       JOIN users u ON u.id = r.user_id
      WHERE r.is_active AND r.report_type = $1 AND u.is_active`,
    [reportType],
  );

  if (!due.length) return 0;
  if (!mailer) {
    log.warn({ pending: due.length }, 'SMTP nije podesen - izvestaji nisu poslati');
    return 0;
  }

  let sent = 0;
  for (const r of due) {
    const { from, to } = periodBounds(reportType);
    try {
      // Autor vidi samo svoje brojeve (sekcija 11)
      const authorSlug = r.role === 'author' ? r.author_slug : null;
      const html = await buildOverviewReport(r.site, from, to, authorSlug);
      const recipients = r.recipients?.length ? r.recipients : [r.email];

      await mailer.sendMail({
        from: config.smtp.from,
        to: recipients.join(','),
        subject: `Pulse ${reportType === 'weekly' ? 'nedeljni' : 'mesečni'} izveštaj — ${from} do ${to}`,
        html,
      });

      await pgQuery('UPDATE scheduled_reports SET last_sent_at = now() WHERE id = $1', [r.id]);
      sent++;
    } catch (err) {
      log.error({ err: err.message, reportId: r.id }, 'izvestaj nije poslat');
    }
  }
  return sent;
}
