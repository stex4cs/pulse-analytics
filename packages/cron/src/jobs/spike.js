/**
 * Live-match spike detekcija (sekcija 9.4).
 *
 * Okidac: pageviews u minutu > 3x prosek za taj dan u nedelji i to doba dana.
 * Baseline se cita iz hourly_traffic u Postgres-u (trajan) jer minute_pulse
 * u ClickHouse-u zivi samo 14 dana - premalo za pouzdan nedeljni obrazac.
 *
 * Alert nosi i to sta vuce spike, jer urednik na osnovu toga odlucuje
 * (sekcija 9.4: "sa naznakom koji clanak/kategorija vuce spike").
 */
import { chQuery, pgQuery, pgQueryOne, config, metrics, createLogger } from '@pulse/shared';

const log = createLogger('spike');
const num = (v) => Number(v ?? 0);

/** Prosek pageview-a po minutu za isti dan u nedelji i isti sat, poslednje 4 nedelje. */
async function baselineForMinute(site, minuteUtc) {
  const row = await pgQueryOne(
    `SELECT avg(pageviews) / 60.0 AS per_min, count(*) AS samples
       FROM hourly_traffic
      WHERE site = $1
        AND category_root = ''
        AND extract(dow  from hour_utc) = extract(dow  from $2::timestamptz)
        AND extract(hour from hour_utc) = extract(hour from $2::timestamptz)
        AND hour_utc >= $2::timestamptz - INTERVAL '28 days'
        AND hour_utc <  date_trunc('hour', $2::timestamptz)`,
    [site, minuteUtc],
  );
  return { perMin: num(row?.per_min), samples: num(row?.samples) };
}

/** Sta vuce spike: kategorija i clanak sa najvise pregleda u poslednja 3 minuta. */
async function findDriver(site) {
  const rows = await chQuery(`
    SELECT article_id, any(title) AS title, category_root, count() AS pageviews
      FROM pulse.events
     WHERE site = {site:String}
       AND event_type = 'pageview'
       AND is_bot = 0
       AND timestamp >= now() - INTERVAL 3 MINUTE
     GROUP BY article_id, category_root
     ORDER BY pageviews DESC
     LIMIT 1`, { site });

  const top = rows[0];
  if (!top) return { type: 'unknown', value: '-', pageviews: 0 };

  if (top.article_id) {
    return {
      type: 'article',
      value: top.title || top.article_id,
      articleId: top.article_id,
      pageviews: num(top.pageviews),
    };
  }
  return { type: 'category', value: top.category_root || '-', pageviews: num(top.pageviews) };
}

async function inCooldown(site) {
  const row = await pgQueryOne(
    `SELECT 1 FROM spike_alerts
      WHERE site = $1 AND detected_at > now() - ($2 || ' minutes')::interval
      LIMIT 1`,
    [site, String(config.cron.spikeCooldownMin)],
  );
  return Boolean(row);
}

async function notify(alert) {
  if (!config.cron.slackWebhook) return false;
  const text = [
    `:rotating_light: *Pulse spike* na tvarenasport.${alert.site}`,
    `*${alert.pageviews_per_min}* pregleda/min (prosek ${alert.baseline_per_min.toFixed(1)}, ${alert.multiplier.toFixed(1)}x)`,
    `Vuce: *${alert.driver_value}* (${alert.driver_type}, ${alert.driver_pageviews} pregleda u 3 min)`,
  ].join('\n');

  try {
    const res = await fetch(config.cron.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (err) {
    log.error({ err: err.message }, 'Slack obavestenje nije poslato');
    return false;
  }
}

export async function detectSpikes() {
  let detected = 0;

  for (const site of config.sites) {
    // Poslednji ZAVRSEN minut - tekuci je jos nepotpun
    const rows = await chQuery(`
      SELECT formatDateTime(minute, '%Y-%m-%dT%H:%M:00Z') AS minute_utc,
             sum(pageviews) AS pageviews
        FROM pulse.minute_pulse
       WHERE site = {site:String}
         AND minute = toStartOfMinute(now() - INTERVAL 1 MINUTE)
       GROUP BY minute`, { site });

    const current = rows[0];
    if (!current) continue;

    const pageviews = num(current.pageviews);
    if (pageviews < config.cron.spikeMinPageviews) continue;

    const { perMin, samples } = await baselineForMinute(site, current.minute_utc);
    // Bez bar 2 istorijska uzorka nema smisla porediti
    if (samples < 2 || perMin <= 0) continue;

    const multiplier = pageviews / perMin;
    if (multiplier < config.cron.spikeMultiplier) continue;
    if (await inCooldown(site)) continue;

    const driver = await findDriver(site);
    const alert = {
      site,
      minute_utc: current.minute_utc,
      pageviews_per_min: pageviews,
      baseline_per_min: perMin,
      multiplier,
      driver_type: driver.type,
      driver_value: String(driver.value).slice(0, 500),
      driver_pageviews: driver.pageviews,
    };

    const notified = await notify(alert);

    await pgQuery(
      `INSERT INTO spike_alerts
         (site, minute_utc, pageviews_per_min, baseline_per_min, multiplier,
          driver_type, driver_value, driver_pageviews, notified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (site, minute_utc) DO NOTHING`,
      [site, alert.minute_utc, pageviews, perMin.toFixed(2), multiplier.toFixed(2),
        alert.driver_type, alert.driver_value, alert.driver_pageviews, notified],
    );

    metrics.spikeAlerts.inc({ site });
    log.warn(alert, 'spike detektovan');
    detected++;
  }

  return detected;
}
