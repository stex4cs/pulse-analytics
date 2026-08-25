/**
 * Seed: admin nalog + (opciono) sinteticki saobracaj za lokalni razvoj.
 *
 *   node scripts/seed.mjs --admin=urednik@tvarenasport.com --password=...
 *   node scripts/seed.mjs --demo=7          # 7 dana sintetickog saobracaja
 *
 * Demo podaci se upisuju direktno u ClickHouse (zaobilaze ingest) da bi se
 * dashboard mogao videti pun bez cekanja na stvarni saobracaj.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import {
  chInsert, pgQuery, pgQueryOne, closeClickHouse, closePostgres,
  resolveTrafficSource, toClickHouseDateTime, config,
} from '@pulse/shared';

const arg = (name, fallback) => {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : fallback;
};

// ── Admin nalog ─────────────────────────────────────────────────────────────
async function seedAdmin() {
  const email = arg('admin', 'admin@tvarenasport.com');
  const password = arg('password', crypto.randomBytes(12).toString('base64url'));

  const existing = await pgQueryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing) {
    console.log(`Admin ${email} već postoji (id ${existing.id}).`);
    return;
  }

  const hash = await argon2.hash(password, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
  });

  await pgQuery(
    `INSERT INTO users (email, name, password_hash, role, sites)
     VALUES ($1, $2, $3, 'admin', $4)`,
    [email.toLowerCase(), 'Pulse Admin', hash, config.sites],
  );

  console.log('\n─────────────────────────────────────────────');
  console.log(`  Admin nalog: ${email}`);
  console.log(`  Lozinka    : ${password}`);
  console.log('  Promenite je posle prve prijave.');
  console.log('─────────────────────────────────────────────\n');
}

// ── Sinteticki saobracaj ────────────────────────────────────────────────────
const AUTHORS = ['milan-nastic', 'jelena-popovic', 'stefan-ilic', 'ana-markovic', 'nikola-djuric'];
const CATEGORIES = [
  ['fudbal/superliga-srbije', ['fk-partizan', 'crvena-zvezda', 'superliga-srbije']],
  ['fudbal/liga-sampiona', ['liga-sampiona', 'real-madrid', 'mancester-siti']],
  ['kosarka/nba', ['nba', 'nikola-jokic', 'denver-nagets']],
  ['kosarka/evroliga', ['evroliga', 'partizan-kk', 'zvezda-kk']],
  ['tenis/atp', ['novak-djokovic', 'atp', 'vimbldon']],
  ['ostali-sportovi/odbojka', ['odbojka', 'reprezentacija']],
];
const CONTENT_TYPES = ['news', 'news', 'news', 'video', 'column', 'live-blog'];
const DEVICES = [['mobile', 0.72], ['desktop', 0.22], ['tablet', 0.05], ['tv', 0.01]];

/**
 * Geografija kakvu srpski sportski portal stvarno ima: dominantna Srbija,
 * region, pa dijaspora. [drzava, grad, lat, lon, tezina]
 */
const PLACES = [
  ['RS', 'Belgrade',    44.81, 20.46, 0.34],
  ['RS', 'Novi Sad',    45.25, 19.83, 0.09],
  ['RS', 'Nis',         43.32, 21.90, 0.05],
  ['RS', 'Kragujevac',  44.01, 20.91, 0.03],
  ['RS', 'Subotica',    46.10, 19.67, 0.02],
  ['RS', 'Cacak',       43.89, 20.35, 0.02],
  ['RS', 'Zrenjanin',   45.38, 20.39, 0.02],
  ['RS', 'Pancevo',     44.87, 20.64, 0.02],
  ['BA', 'Banja Luka',  44.77, 17.19, 0.04],
  ['BA', 'Sarajevo',    43.86, 18.41, 0.03],
  ['ME', 'Podgorica',   42.44, 19.26, 0.03],
  ['HR', 'Zagreb',      45.81, 15.98, 0.02],
  ['MK', 'Skopje',      41.99, 21.43, 0.02],
  ['SI', 'Ljubljana',   46.06, 14.51, 0.01],
  ['XK', 'Pristina',    42.67, 21.17, 0.01],
  // Dijaspora
  ['DE', 'Munich',      48.14, 11.58, 0.05],
  ['DE', 'Frankfurt',   50.11,  8.68, 0.03],
  ['DE', 'Berlin',      52.52, 13.40, 0.02],
  ['AT', 'Vienna',      48.21, 16.37, 0.04],
  ['CH', 'Zurich',      47.37,  8.54, 0.03],
  ['SE', 'Stockholm',   59.33, 18.07, 0.02],
  ['FR', 'Paris',       48.86,  2.35, 0.01],
  ['US', 'Chicago',     41.88, -87.63, 0.02],
  ['US', 'New York',    40.71, -74.01, 0.01],
  ['CA', 'Toronto',     43.65, -79.38, 0.01],
  ['AU', 'Sydney',     -33.87, 151.21, 0.01],
];
const REFERRERS = [
  ['https://www.google.com/', 0.30],
  ['https://news.google.com/', 0.18],
  ['https://www.facebook.com/', 0.20],
  ['', 0.15],
  ['https://t.co/x', 0.05],
  ['https://www.instagram.com/', 0.05],
  ['https://www.blic.rs/', 0.04],
  ['https://www.youtube.com/', 0.03],
];

/**
 * Rubrike ne dobijaju saobracaj sa istih mesta - to je ceo smisao preseka
 * kanal x kategorija (sekcija 10.3). NBA i tenis se pretrazuju, domaci fudbal
 * i kosarka se dele po Facebook-u, odbojka zivi od Discover talasa.
 */
const CATEGORY_CHANNEL_BIAS = {
  'fudbal/superliga-srbije':  { 'https://www.facebook.com/': 2.6, 'https://www.google.com/': 0.5 },
  'fudbal/liga-sampiona':     { 'https://www.google.com/': 1.5, 'https://t.co/x': 2.0 },
  'kosarka/nba':              { 'https://www.google.com/': 2.4, 'https://www.facebook.com/': 0.4 },
  'kosarka/evroliga':         { 'https://www.facebook.com/': 1.9, 'https://news.google.com/': 0.6 },
  'tenis/atp':                { 'https://www.google.com/': 2.2, 'https://www.instagram.com/': 1.8 },
  'ostali-sportovi/odbojka':  { 'https://news.google.com/': 3.0, 'https://www.google.com/': 0.4 },
};

/**
 * Dijaspora ne dolazi istim putem kao domaci citaoci: manje direktnog kucanja
 * adrese, vise Discover-a i Facebook-a. Bez ovoga presek geografija x kanal
 * izgleda ujednaceno, sto u stvarnosti nikad nije slucaj.
 */
const COUNTRY_CHANNEL_BIAS = {
  RS: { '': 1.6, 'https://www.google.com/': 1.2 },
  BA: { 'https://www.facebook.com/': 1.4 },
  ME: { 'https://www.facebook.com/': 1.4 },
};
const DIASPORA_BIAS = {
  '': 0.45,
  'https://news.google.com/': 1.9,
  'https://www.facebook.com/': 1.5,
  'https://www.google.com/': 0.8,
};

function referrerFor(category, country) {
  const catBias = CATEGORY_CHANNEL_BIAS[category] ?? {};
  const geoBias = COUNTRY_CHANNEL_BIAS[country] ?? DIASPORA_BIAS;
  return weighted(REFERRERS.map(([url, w]) => [
    url,
    w * (catBias[url] ?? 1) * (geoBias[url] ?? 1),
  ]));
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function weighted(pairs) {
  // Tezine se normalizuju, pa pozivaoci ne moraju da paze da sabiraju na 1
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [value, weight] of pairs) {
    r -= weight;
    if (r <= 0) return value;
  }
  return pairs[pairs.length - 1][0];
}

/** Dnevni obrazac saobracaja: jutarnji i vecernji vrh, nocna dolina. */
function hourWeight(hour) {
  const curve = [0.2, 0.1, 0.08, 0.06, 0.07, 0.15, 0.4, 0.7, 0.9, 1.0, 0.95, 0.9,
    0.95, 0.9, 0.85, 0.9, 1.0, 1.1, 1.3, 1.5, 1.4, 1.1, 0.7, 0.4];
  return curve[hour];
}

async function seedDemo(days) {
  console.log(`Generišem ${days} dana sintetičkog saobraćaja…`);

  const articles = [];
  for (let i = 0; i < days * 40; i++) {
    const [category, tags] = pick(CATEGORIES);
    const publishedDaysAgo = Math.random() * days;
    articles.push({
      id: String(70000 + i),
      title: `${pick(['Partizan', 'Zvezda', 'Jokić', 'Đoković', 'Real', 'Reprezentacija'])} ${
        pick(['ubedljiv u derbiju', 'iznenadio favorita', 'ruši rekorde', 'nastavlja niz', 'objavio odluku'])}`,
      author: pick(AUTHORS),
      category,
      tags: tags.slice(0, 2 + Math.floor(Math.random() * 2)),
      contentType: pick(CONTENT_TYPES),
      wordCount: 200 + Math.floor(Math.random() * 800),
      publishedAt: new Date(Date.now() - publishedDaysAgo * 86_400_000),
    });
  }

  const now = Date.now();
  let total = 0;

  for (let day = days - 1; day >= 0; day--) {
    const rows = [];
    const dayStart = new Date(now - day * 86_400_000);
    dayStart.setUTCHours(0, 0, 0, 0);

    const live = articles.filter((a) => a.publishedAt.getTime() <= dayStart.getTime() + 86_400_000);
    if (!live.length) continue;

    for (let hour = 0; hour < 24; hour++) {
      if (day === 0 && dayStart.getTime() + hour * 3_600_000 > now) break;

      const sessions = Math.round(140 * hourWeight(hour) * (0.8 + Math.random() * 0.4));

      for (let s = 0; s < sessions; s++) {
        const sessionId = `s${crypto.randomBytes(10).toString('hex')}`;
        // Mesto se bira po sesiji: isti posetilac ne skace iz grada u grad
        const place = weighted(PLACES.map((p) => [p, p[4]]));
        const hasConsent = Math.random() < 0.65;
        const visitorId = hasConsent ? `v${crypto.randomBytes(10).toString('hex')}` : '';
        // Sesija ima svoju "temu": referrer se bira prema njoj, a clanci se
        // onda biraju iz iste rubrike - kao sto se i u stvarnosti desava.
        const sessionCategory = pick(CATEGORIES)[0];
        const referrer = referrerFor(sessionCategory, place[0]);
        const device = weighted(DEVICES);
        const source = resolveTrafficSource({
          url: 'https://tvarenasport.com/x',
          referrer,
          internalDomains: config.internalDomains,
        });

        // Discover donosi kratke sesije, organic duže (sekcija 5.3)
        const pageviews = source.traffic_source === 'google_discover'
          ? (Math.random() < 0.75 ? 1 : 2)
          : 1 + Math.floor(Math.random() * 3);

        const baseTs = dayStart.getTime() + hour * 3_600_000 + Math.random() * 3_600_000;

        for (let p = 0; p < pageviews; p++) {
          const sameTopic = live.filter((a) => a.category === sessionCategory);
          const article = pick(sameTopic.length ? sameTopic : live);
          const ts = baseTs + p * 90_000;
          if (ts > now) break;

          const common = {
            session_id: sessionId,
            visitor_id: visitorId,
            is_new_visitor: p === 0 && Math.random() < 0.4 ? 1 : 0,
            has_consent: hasConsent ? 1 : 0,
            site: 'rs',
            url: `https://tvarenasport.com/${article.category}/${article.id}`,
            path: `/${article.category}/${article.id}`,
            article_id: article.id,
            title: article.title,
            author: article.author,
            category: article.category,
            tags: article.tags,
            content_type: article.contentType,
            published_at: toClickHouseDateTime(article.publishedAt.getTime()).slice(0, 19),
            word_count: article.wordCount,
            referrer_domain: source.referrer_domain,
            traffic_source: source.traffic_source,
            channel_detail: source.channel_detail,
            utm_source: '', utm_medium: '', utm_campaign: '',
            device_type: device,
            browser: device === 'mobile' ? 'Chrome 126' : 'Chrome 126',
            os: device === 'mobile' ? 'Android' : 'Windows 10/11',
            country: place[0],
            city: place[1],
            lat: place[2],
            lon: place[3],
            ip_hash: crypto.randomBytes(16).toString('hex'),
            viewport_width: device === 'mobile' ? 390 : 1440,
            viewport_bucket: device === 'mobile' ? 375 : 1440,
            clock_skew_ms: 0,
            scroll_depth: 0, active_time_ms: 0,
            click_selector: '', click_x: 0, click_y: 0,
            video_progress: 0, ab_test_id: '', ab_variant: '',
            is_bot: 0, bot_reason: '',
          };

          const mk = (type, extra = {}, offsetMs = 0) => ({
            ...common,
            event_id: crypto.randomUUID(),
            event_type: type,
            timestamp: toClickHouseDateTime(ts + offsetMs),
            client_timestamp: toClickHouseDateTime(ts + offsetMs),
            ...extra,
          });

          rows.push(mk('pageview'));

          // Scroll: opada sa dubinom, Discover ima plići obrazac
          const engagement = source.traffic_source === 'google_discover' ? 0.55 : 0.8;
          let depth = 0;
          for (const mark of [25, 50, 75, 100]) {
            if (Math.random() > engagement - (mark / 400)) break;
            depth = mark;
            rows.push(mk('scroll_depth', { scroll_depth: mark }, mark * 200));
          }

          const expectedMs = (article.wordCount / 200) * 60000;
          const activeMs = Math.round(expectedMs * (0.15 + Math.random() * 1.3));
          rows.push(mk('time_on_page', { active_time_ms: activeMs, scroll_depth: depth }, 60_000));

          if (Math.random() < 0.12 && hasConsent) {
            rows.push(mk('click', {
              click_selector: pick(['a.article-card', 'button.cta', 'a.related-link']),
              click_x: Math.floor(Math.random() * (device === 'mobile' ? 375 : 1440)),
              click_y: Math.floor(Math.random() * 2400),
            }, 30_000));
          }

          if (article.contentType === 'video' && Math.random() < 0.5) {
            rows.push(mk('video_play', {}, 5_000));
            for (const mark of [25, 50, 75, 100]) {
              if (Math.random() > 0.7) break;
              rows.push(mk('video_progress', { video_progress: mark }, 5_000 + mark * 400));
            }
          }
        }
      }
    }

    for (let i = 0; i < rows.length; i += 5000) {
      await chInsert('events', rows.slice(i, i + 5000));
    }
    total += rows.length;
    process.stdout.write(`  dan -${day}: ${rows.length} eventa\n`);
  }

  console.log(`\nUpisano ${total} eventa. Pokrenite agregaciju:`);
  console.log('  npm run -w @pulse/cron run-once -- articles 30');
  console.log(`  npm run -w @pulse/cron run-once -- daily ${new Date(now - days * 86400000).toISOString().slice(0, 10)} ${new Date().toISOString().slice(0, 10)}`);
}

try {
  await seedAdmin();
  const demo = Number(arg('demo', 0));
  if (demo > 0) await seedDemo(Math.min(90, demo));
} catch (err) {
  console.error('Seed pao:', err.message);
  process.exitCode = 1;
} finally {
  await closeClickHouse();
  await closePostgres();
}
