/**
 * Demo režim.
 *
 * Kad je `NEXT_PUBLIC_PULSE_DEMO=1`, dashboard ne dodiruje nijedan backend:
 * svi odgovori se generišu ovde, u pregledaču. To je jedini bezbedan način
 * da se UI javno pokaže — API ostaje interni, bez CORS-a i bez izlaganja.
 *
 * VAŽNO: podaci su izmišljeni i deterministički generisani. Ne predstavljaju
 * stvarni saobraćaj tvarenasport.com-a. Svaki ekran u demo režimu nosi
 * vidljivu oznaku (vidi DemoBanner u components/ui.jsx).
 */

export const IS_DEMO = process.env.NEXT_PUBLIC_PULSE_DEMO === '1';

export const DEMO_USER = {
  id: 0,
  email: 'demo@example.com',
  name: 'Demo urednik',
  role: 'editor',
  authorSlug: null,
  sites: ['rs'],
};

/** Deterministički PRNG — isti demo na svakom učitavanju i svakom uređaju. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const AUTHORS = ['milan-nastic', 'jelena-popovic', 'stefan-ilic', 'ana-markovic', 'nikola-djuric'];

const CATEGORIES = [
  { root: 'fudbal', full: 'fudbal/superliga-srbije', share: 0.24 },
  { root: 'fudbal', full: 'fudbal/liga-sampiona', share: 0.15 },
  { root: 'kosarka', full: 'kosarka/evroliga', share: 0.18 },
  { root: 'kosarka', full: 'kosarka/nba', share: 0.14 },
  { root: 'tenis', full: 'tenis/atp', share: 0.16 },
  { root: 'ostali-sportovi', full: 'ostali-sportovi/odbojka', share: 0.13 },
];

const SOURCES = [
  { source: 'search_organic', label: 'Organska pretraga', share: 0.32, bounce: 35.4, pages: 1.95, sec: 118 },
  { source: 'social_meta', label: 'Facebook / Instagram', share: 0.27, bounce: 32.0, pages: 2.05, sec: 132 },
  { source: 'direct', label: 'Direktan', share: 0.16, bounce: 36.2, pages: 1.93, sec: 124 },
  { source: 'google_discover', label: 'Google Discover', share: 0.13, bounce: 76.7, pages: 1.23, sec: 47 },
  { source: 'social_x', label: 'X (Twitter)', share: 0.05, bounce: 41.0, pages: 1.71, sec: 96 },
  { source: 'referral', label: 'Referral', share: 0.04, bounce: 38.5, pages: 1.82, sec: 104 },
  { source: 'social_youtube', label: 'YouTube', share: 0.03, bounce: 44.2, pages: 1.60, sec: 88 },
];

const TAGS = [
  'nikola-jokic', 'crvena-zvezda', 'fk-partizan', 'novak-djokovic', 'superliga-srbije',
  'evroliga', 'nba', 'liga-sampiona', 'reprezentacija', 'atp', 'real-madrid', 'odbojka',
];

const HEADLINES = [
  'Jokić objavio odluku o nastavku karijere',
  'Zvezda ubedljiva u derbiju, Partizan bez odgovora',
  'Đoković se vraća na šljaku posle pauze',
  'Poznat raspored za osminu finala Lige šampiona',
  'Reprezentacija saznala rivale u kvalifikacijama',
  'Partizan pojačava tim pred nastavak sezone',
  'Preokret u poslednjem minutu za prolaz dalje',
  'Trener posle poraza: Nismo zaslužili ovo',
  'Odbojkašice u finalu posle velike borbe',
  'NBA noć: tripl-dabl i rekord franšize',
  'Superliga: novi lider posle 18. kola',
  'Evroliga stiže u Beograd, poznat termin',
];

const DEVICES = ['mobile', 'desktop', 'tablet'];

/** [drzava, grad, lat, lon, udeo] - Srbija, region, dijaspora. */
const PLACES = [
  ['RS', 'Belgrade', 44.81, 20.46, 0.34], ['RS', 'Novi Sad', 45.25, 19.83, 0.09],
  ['RS', 'Nis', 43.32, 21.90, 0.05], ['RS', 'Kragujevac', 44.01, 20.91, 0.03],
  ['RS', 'Subotica', 46.10, 19.67, 0.02], ['RS', 'Cacak', 43.89, 20.35, 0.02],
  ['BA', 'Banja Luka', 44.77, 17.19, 0.04], ['BA', 'Sarajevo', 43.86, 18.41, 0.03],
  ['ME', 'Podgorica', 42.44, 19.26, 0.03], ['HR', 'Zagreb', 45.81, 15.98, 0.02],
  ['MK', 'Skopje', 41.99, 21.43, 0.02], ['SI', 'Ljubljana', 46.06, 14.51, 0.01],
  ['XK', 'Pristina', 42.67, 21.17, 0.01],
  ['DE', 'Munich', 48.14, 11.58, 0.05], ['DE', 'Frankfurt', 50.11, 8.68, 0.03],
  ['DE', 'Berlin', 52.52, 13.40, 0.02], ['AT', 'Vienna', 48.21, 16.37, 0.04],
  ['CH', 'Zurich', 47.37, 8.54, 0.03], ['SE', 'Stockholm', 59.33, 18.07, 0.02],
  ['FR', 'Paris', 48.86, 2.35, 0.01], ['US', 'Chicago', 41.88, -87.63, 0.02],
  ['US', 'New York', 40.71, -74.01, 0.01], ['CA', 'Toronto', 43.65, -79.38, 0.01],
  ['AU', 'Sydney', -33.87, 151.21, 0.01],
];

/** Rubrike ne dobijaju saobracaj sa istih mesta - to je poenta preseka. */
const CHANNEL_BIAS = {
  'fudbal/superliga-srbije': { social_meta: 2.6, search_organic: 0.5 },
  'fudbal/liga-sampiona': { search_organic: 1.5, social_x: 2.0 },
  'kosarka/nba': { search_organic: 2.4, social_meta: 0.4 },
  'kosarka/evroliga': { social_meta: 1.9, google_discover: 0.6 },
  'tenis/atp': { search_organic: 2.2, social_meta: 0.7 },
  'ostali-sportovi/odbojka': { google_discover: 3.0, search_organic: 0.4 },
};

/** Razrada kanala za entitet, sa pomerajem po rubrici. */
function biasedSources(total, seed, bias = {}) {
  const rand = rng(seed);
  const raw = SOURCES.map((s) => ({
    source: s.source,
    label: s.label,
    weight: s.share * (bias[s.source] ?? 1) * (0.85 + rand() * 0.3),
  }));
  const sum = raw.reduce((a, b) => a + b.weight, 0);
  return raw
    .map((r) => ({ source: r.source, label: r.label, pageviews: Math.round(total * (r.weight / sum)) }))
    .sort((a, b) => b.pageviews - a.pageviews);
}

function geoRows(total, seed) {
  const rand = rng(seed);
  const sum = PLACES.reduce((a, p) => a + p[4], 0);
  return PLACES.map((p) => {
    const pv = Math.round(total * (p[4] / sum) * (0.85 + rand() * 0.3));
    return {
      country: p[0], city: p[1], lat: p[2], lon: p[3],
      pageviews: pv, uniqueVisitors: Math.round(pv * 0.42),
    };
  }).filter((r) => r.pageviews > 0);
}

/** Dnevni obrazac saobraćaja: jutarnji rast, večernji vrh. */
const HOUR_CURVE = [0.2, 0.1, 0.08, 0.06, 0.07, 0.15, 0.4, 0.7, 0.9, 1.0, 0.95, 0.9,
  0.95, 0.9, 0.85, 0.9, 1.0, 1.1, 1.3, 1.5, 1.4, 1.1, 0.7, 0.4];

const DAILY_PAGEVIEWS = 66_000;

function dateStr(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function range(days) {
  return { from: dateStr(days - 1), to: dateStr(0) };
}

/** Članci se generišu jednom i koriste svuda, da brojevi budu dosledni. */
const ARTICLES = (() => {
  const rand = rng(20260825);
  const out = [];
  for (let i = 0; i < 60; i++) {
    const cat = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
    const author = AUTHORS[Math.floor(rand() * AUTHORS.length)];
    const publishedDaysAgo = rand() * 30;
    const total = Math.round(400 + rand() * rand() * 48_000);
    const contentType = rand() < 0.08 ? 'live-blog' : rand() < 0.15 ? 'video' : rand() < 0.2 ? 'column' : 'news';
    const wordCount = 220 + Math.round(rand() * 700);

    out.push({
      articleId: String(76000 + i),
      title: HEADLINES[i % HEADLINES.length] + (i >= HEADLINES.length ? ` (${Math.floor(i / HEADLINES.length) + 1})` : ''),
      author,
      category: cat.full,
      categoryRoot: cat.root,
      contentType,
      tags: [TAGS[i % TAGS.length], TAGS[(i * 3 + 1) % TAGS.length]],
      wordCount,
      publishedAt: new Date(Date.now() - publishedDaysAgo * 86_400_000).toISOString(),
      pageviewsTotal: total,
      pageviews24h: Math.round(total * (publishedDaysAgo < 1 ? 0.7 : 0.06) * (0.5 + rand())),
      pageviews7d: Math.round(total * (publishedDaysAgo < 7 ? 0.85 : 0.2)),
      uniqueVisitors: Math.round(total * 0.62),
      avgTimeOnPageSec: contentType === 'live-blog'
        ? 900 + Math.round(rand() * 2400)
        : Math.round((wordCount / 200) * 60 * (0.35 + rand() * 0.9)),
      readCompletionRate: Math.round((6 + rand() * 26) * 10) / 10,
      scrollCompletionRate: Math.round((8 + rand() * 30) * 10) / 10,
      trendingScore: Math.round(rand() * rand() * 9 * 100) / 100,
    });
  }
  return out.sort((a, b) => b.pageviewsTotal - a.pageviewsTotal);
})();

function sourceBreakdown(total, seed) {
  const rand = rng(seed);
  const out = [];
  let left = total;
  for (const [i, s] of SOURCES.entries()) {
    const pv = i === SOURCES.length - 1
      ? Math.max(0, left)
      : Math.round(total * s.share * (0.7 + rand() * 0.6));
    left -= pv;
    out.push({ source: s.source, label: s.label, pageviews: Math.max(0, pv) });
  }
  return out.sort((a, b) => b.pageviews - a.pageviews);
}

// ── Generatori po ruti ──────────────────────────────────────────────────────

function overview(days) {
  const total = Math.round(DAILY_PAGEVIEWS * days * 0.98);
  const sources = sourceBreakdown(total, 7).map((s) => {
    const meta = SOURCES.find((x) => x.source === s.source);
    return {
      ...s,
      uniqueVisitors: Math.round(s.pageviews * 0.58),
      bounceRate: meta.bounce,
      share: Math.round((s.pageviews / total) * 1000) / 10,
    };
  });

  const rand = rng(days * 31 + 5);
  const hourly = HOUR_CURVE.map((w, hour) => ({
    hour,
    today: hour <= new Date().getUTCHours() ? Math.round(DAILY_PAGEVIEWS / 24 * w * (0.85 + rand() * 0.3)) : 0,
    lastWeek: Math.round(DAILY_PAGEVIEWS / 24 * w * (0.8 + rand() * 0.35)),
  }));

  return {
    site: 'rs',
    range: range(days),
    totals: {
      pageviews: total,
      uniqueVisitors: Math.round(total * 0.34),
      trendPct: 8.4,
    },
    sources,
    hourly,
    topArticles: ARTICLES.slice(0, 10).map((a) => ({
      articleId: a.articleId,
      title: a.title,
      author: a.author,
      category: a.category,
      pageviews24h: a.pageviews24h,
      pageviewsTotal: a.pageviewsTotal,
      trendingScore: a.trendingScore,
    })),
    spike: {
      detectedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
      pageviewsPerMin: 1840,
      multiplier: 4.2,
      driverType: 'article',
      driverValue: ARTICLES[0].title,
    },
  };
}

function realtime() {
  const rand = rng(Math.floor(Date.now() / 10_000));
  const perMinute = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - (29 - i) * 60_000);
    return {
      minute: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      pageviews: Math.round(700 + rand() * 900),
    };
  });
  return {
    activeVisitors: Math.round(2400 + rand() * 900),
    pageviews5m: perMinute.slice(-5).reduce((s, p) => s + p.pageviews, 0),
    perMinute,
    topArticles: ARTICLES.slice(0, 8).map((a, i) => ({
      articleId: a.articleId,
      title: a.title,
      author: a.author,
      category: a.category,
      pageviews: Math.round(320 / (i + 1) + rand() * 60),
    })),
    byCategory: [...new Set(CATEGORIES.map((c) => c.root))].map((root, i) => ({
      category: root,
      pageviews: Math.round(900 / (i + 1) + rand() * 200),
    })),
  };
}

function authors(days) {
  const rand = rng(days + 11);
  const rows = AUTHORS.map((author, i) => {
    const mine = ARTICLES.filter((a) => a.author === author);
    const pageviews = Math.round(DAILY_PAGEVIEWS * days * (0.26 - i * 0.035) * (0.9 + rand() * 0.2));
    const articles = 4 + Math.round(rand() * 9) + Math.round(days / 3);
    return {
      author,
      pageviews,
      uniqueVisitors: Math.round(pageviews * 0.42),
      articlesPublished: articles,
      avgPageviewsPerArticle: Math.round(pageviews / articles),
      avgTimeOnPageSec: Math.round(95 + rand() * 90),
      avgScrollCompletion: Math.round((38 + rand() * 26) * 10) / 10,
      readCompletionRate: Math.round((9 + rand() * 14) * 10) / 10,
      trendPct: Math.round((rand() * 44 - 16) * 10) / 10,
      _articles: mine,
    };
  }).sort((a, b) => b.pageviews - a.pageviews);

  return { range: range(days), authors: rows.map(({ _articles, ...r }) => r) };
}

function authorDetail(slug, days) {
  const list = authors(days).authors;
  const row = list.find((a) => a.author === slug) ?? list[0];
  const rand = rng(slug.length * 97 + days);
  const mine = ARTICLES.filter((a) => a.author === row.author);

  return {
    author: row.author,
    range: range(days),
    totals: {
      pageviews: row.pageviews,
      uniqueVisitors: row.uniqueVisitors,
      articlesPublished: row.articlesPublished,
      readCompletionRate: row.readCompletionRate,
      avgTimeOnPageSec: row.avgTimeOnPageSec,
    },
    series: Array.from({ length: days }, (_, i) => {
      const pv = Math.round(row.pageviews / days * (0.65 + rand() * 0.7));
      return { date: dateStr(days - 1 - i), pageviews: pv, uniqueVisitors: Math.round(pv * 0.45) };
    }),
    topArticles: mine.slice(0, 12).map((a) => ({
      articleId: a.articleId,
      title: a.title,
      category: a.category,
      publishedAt: a.publishedAt,
      pageviewsTotal: a.pageviewsTotal,
      pageviews7d: a.pageviews7d,
      readCompletionRate: a.readCompletionRate,
      avgTimeOnPageSec: a.avgTimeOnPageSec,
    })),
    byCategory: [...new Set(mine.map((a) => a.category))].slice(0, 8).map((category) => ({
      category,
      pageviews: mine.filter((a) => a.category === category).reduce((s, a) => s + a.pageviewsTotal, 0),
      articles: mine.filter((a) => a.category === category).length,
    })).sort((a, b) => b.pageviews - a.pageviews),
    byChannel: sourceBreakdown(row.pageviews, slug.length + 3),
  };
}

function categories(days, root) {
  const rand = rng(days * 7 + (root ? root.length : 0));
  const total = DAILY_PAGEVIEWS * days;
  const list = root
    ? CATEGORIES.filter((c) => c.root === root).map((c) => ({ name: c.full, share: c.share }))
    : [...new Set(CATEGORIES.map((c) => c.root))].map((r) => ({
      name: r,
      share: CATEGORIES.filter((c) => c.root === r).reduce((s, c) => s + c.share, 0),
    }));

  return {
    root: root ?? null,
    range: range(days),
    categories: list.map((c) => {
      const pageviews = Math.round(total * c.share * (0.9 + rand() * 0.2));
      const articles = Math.round(days * 6 * c.share * 4);
      return {
        category: c.name,
        pageviews,
        uniqueVisitors: Math.round(pageviews * 0.5),
        articlesPublished: articles,
        avgPageviewsPerArticle: Math.round(pageviews / Math.max(1, articles)),
        avgTimeOnPageSec: Math.round(100 + rand() * 80),
        readCompletionRate: Math.round((9 + rand() * 12) * 10) / 10,
        trendPct: Math.round((rand() * 40 - 14) * 10) / 10,
      };
    }).sort((a, b) => b.pageviews - a.pageviews),
  };
}

function categoryChannels(days) {
  const roots = [...new Set(CATEGORIES.map((c) => c.root))];
  const rand = rng(days * 3 + 19);

  return {
    range: range(days),
    sources: SOURCES.map((s) => ({ source: s.source, label: s.label })),
    rows: roots.map((category) => {
      // Namerno različit obrazac po rubrici: NBA sa Google-a, Superliga sa Facebook-a
      const bias = { fudbal: 'social_meta', kosarka: 'search_organic', tenis: 'search_organic', 'ostali-sportovi': 'direct' }[category];
      const bySource = {};
      let total = 0;
      for (const s of SOURCES) {
        const boost = s.source === bias ? 1.9 : 0.75;
        const pv = Math.round(DAILY_PAGEVIEWS * days * 0.2 * s.share * boost * (0.85 + rand() * 0.3));
        bySource[s.source] = pv;
        total += pv;
      }
      return {
        category,
        total,
        bySource,
        shares: Object.fromEntries(Object.entries(bySource)
          .map(([s, v]) => [s, Math.round((v / total) * 1000) / 10])),
      };
    }).sort((a, b) => b.total - a.total),
  };
}

function categoryCompare(days, names) {
  const rand = rng(names.join('').length + days);
  return {
    range: range(days),
    series: names.map((category) => ({
      category,
      points: Array.from({ length: days }, (_, i) => ({
        date: dateStr(days - 1 - i),
        pageviews: Math.round(DAILY_PAGEVIEWS * 0.15 * (0.6 + rand())),
      })),
    })),
  };
}

function tags(days) {
  const rand = rng(days * 13);
  return {
    range: range(days),
    tags: TAGS.map((tag, i) => {
      const pageviews = Math.round(DAILY_PAGEVIEWS * days * (0.09 - i * 0.006) * (0.8 + rand() * 0.5));
      return {
        tag,
        pageviews: Math.max(300, pageviews),
        uniqueVisitors: Math.max(180, Math.round(pageviews * 0.55)),
        articles: 2 + Math.round(rand() * 14),
        trendingScore: Math.round(rand() * 8 * 100) / 100,
      };
    }).sort((a, b) => b.pageviews - a.pageviews),
  };
}

function tagsTrending() {
  const rand = rng(4242);
  return {
    tags: TAGS.slice(0, 10).map((tag) => ({
      tag,
      pageviews: Math.round(400 + rand() * 3600),
      uniqueVisitors: Math.round(260 + rand() * 2200),
      articles: 1 + Math.round(rand() * 9),
      trendingScore: Math.round((2 + rand() * 7) * 100) / 100,
    })).sort((a, b) => b.trendingScore - a.trendingScore),
  };
}

function tagDetail(tag, days) {
  const rand = rng(tag.length * 71 + days);
  const withTag = ARTICLES.filter((a) => a.tags.includes(tag));
  const list = withTag.length ? withTag : ARTICLES.slice(0, 8);
  const total = list.reduce((s, a) => s + a.pageviewsTotal, 0);

  return {
    tag,
    range: range(days),
    totals: { pageviews: total, uniqueVisitors: Math.round(total * 0.56) },
    series: Array.from({ length: days }, (_, i) => ({
      date: dateStr(days - 1 - i),
      pageviews: Math.round(total / days * (0.5 + rand())),
    })),
    articles: list.map((a) => ({
      articleId: a.articleId,
      title: a.title,
      author: a.author,
      category: a.category,
      publishedAt: a.publishedAt,
      pageviewsTotal: a.pageviewsTotal,
      pageviews7d: a.pageviews7d,
    })),
  };
}

function sources(days) {
  const total = DAILY_PAGEVIEWS * days;
  const rand = rng(days * 17);
  return {
    range: range(days),
    total,
    directNote: 'Direktan saobraćaj je često "lažan": dolazi iz aplikacija (Viber, WhatsApp), '
      + 'email klijenata ili se referrer izgubi na HTTPS→HTTP prelazu. Tagujte newsletter i app '
      + 'deep linkove UTM parametrima da bi ovaj broj bio manji i tačniji.',
    sources: SOURCES.map((s) => {
      const pageviews = Math.round(total * s.share * (0.92 + rand() * 0.16));
      const sessions = Math.round(pageviews / s.pages);
      return {
        source: s.source,
        label: s.label,
        pageviews,
        uniqueVisitors: Math.round(sessions * 0.78),
        sessions,
        avgSessionPages: s.pages,
        bounceRate: s.bounce,
        avgSessionSec: s.sec,
        share: Math.round(s.share * 1000) / 10,
        trendPct: Math.round((rand() * 36 - 12) * 10) / 10,
      };
    }).sort((a, b) => b.pageviews - a.pageviews),
  };
}

function sourcesTimeseries(days) {
  const rand = rng(days * 23);
  return {
    range: range(days),
    sources: SOURCES.map((s) => ({ source: s.source, label: s.label })),
    points: Array.from({ length: days }, (_, i) => {
      const point = { date: dateStr(days - 1 - i) };
      for (const s of SOURCES) {
        // Discover dolazi u talasima
        const wave = s.source === 'google_discover' ? (rand() < 0.25 ? 3.1 : 0.55) : 1;
        point[s.source] = Math.round(DAILY_PAGEVIEWS * s.share * wave * (0.85 + rand() * 0.3));
      }
      return point;
    }),
  };
}

function sourcesDiscover(days) {
  const rand = rng(days * 29);
  return {
    range: range(days),
    series: Array.from({ length: days }, (_, i) => {
      const wave = rand() < 0.25 ? 3.4 : 0.5;
      const pageviews = Math.round(DAILY_PAGEVIEWS * 0.13 * wave);
      return {
        date: dateStr(days - 1 - i),
        pageviews,
        sessions: Math.round(pageviews / 1.23),
        bounceRate: 76.7,
        avgSessionSec: 47,
      };
    }),
    topArticles: ARTICLES.slice(0, 12).map((a) => {
      const discover = Math.round(a.pageviewsTotal * (0.1 + rand() * 0.55));
      return {
        articleId: a.articleId,
        title: a.title,
        author: a.author,
        category: a.category,
        discoverPageviews: discover,
        pageviewsTotal: a.pageviewsTotal,
        discoverShare: Math.round((discover / a.pageviewsTotal) * 1000) / 10,
      };
    }).sort((a, b) => b.discoverPageviews - a.discoverPageviews),
    comparison: ['google_discover', 'search_organic', 'social_meta', 'direct'].map((src) => {
      const s = SOURCES.find((x) => x.source === src);
      return { source: s.source, label: s.label, bounceRate: s.bounce, avgSessionPages: s.pages, avgSessionSec: s.sec };
    }),
    note: 'Discover dolazi u talasima, sa kratkim sesijama i visokim bounce-om. '
      + 'Poređenje sa organskom pretragom pokazuje zašto se ova dva kanala ne smeju mešati.',
  };
}

function sourcesDevices(days) {
  const rand = rng(days * 37);
  return {
    range: range(days),
    devices: DEVICES,
    rows: SOURCES.map((s) => {
      const total = Math.round(DAILY_PAGEVIEWS * days * s.share);
      // Discover je gotovo isključivo mobilni
      const mobileShare = s.source === 'google_discover' ? 0.94 : 0.68 + rand() * 0.12;
      const byDevice = {
        mobile: Math.round(total * mobileShare),
        desktop: Math.round(total * (1 - mobileShare) * 0.82),
        tablet: Math.round(total * (1 - mobileShare) * 0.18),
      };
      return {
        source: s.source,
        label: s.label,
        total,
        byDevice,
        shares: Object.fromEntries(Object.entries(byDevice)
          .map(([d, v]) => [d, Math.round((v / total) * 1000) / 10])),
      };
    }).sort((a, b) => b.total - a.total),
  };
}

function sourcesCampaigns(days) {
  const rand = rng(days * 41);
  const campaigns = [
    ['newsletter', 'email', 'nedeljni-pregled'],
    ['facebook', 'paidsocial', 'derbi-najava'],
    ['google', 'cpc', 'brend-kampanja'],
    ['viber', 'messaging', 'push-vesti'],
    ['instagram', 'paidsocial', 'evroliga-finale'],
  ];
  return {
    range: range(days),
    campaigns: campaigns.map(([utmSource, utmMedium, utmCampaign]) => {
      const pageviews = Math.round(1200 + rand() * 14_000);
      const sessions = Math.round(pageviews / (1.4 + rand()));
      return {
        utmSource,
        utmMedium,
        utmCampaign,
        pageviews,
        sessions,
        pagesPerSession: Math.round((pageviews / sessions) * 100) / 100,
      };
    }).sort((a, b) => b.pageviews - a.pageviews),
  };
}

function articles(query) {
  let list = ARTICLES;
  const q = query.get('q');
  const contentType = query.get('contentType');
  if (q) list = list.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()));
  if (contentType) list = list.filter((a) => a.contentType === contentType);
  return { articles: list };
}

function articleDetail(id) {
  const a = ARTICLES.find((x) => x.articleId === id) ?? ARTICLES[0];
  const rand = rng(Number(a.articleId));

  const p25 = Math.round(a.pageviewsTotal * 0.62);
  const p50 = Math.round(p25 * (0.5 + rand() * 0.2));
  const p75 = Math.round(p50 * (0.45 + rand() * 0.2));
  const p100 = Math.round(p75 * (0.28 + rand() * 0.2));

  const publishedMs = new Date(a.publishedAt).getTime();
  const hours = Math.min(96, Math.max(6, Math.round((Date.now() - publishedMs) / 3_600_000)));

  const peers = ARTICLES.filter((x) => x.categoryRoot === a.categoryRoot)
    .map((x) => x.pageviewsTotal).sort((x, y) => x - y);
  const percentile = Math.round((peers.filter((v) => v <= a.pageviewsTotal).length / peers.length) * 100);

  return {
    article: {
      articleId: a.articleId,
      title: a.title,
      url: null,
      author: a.author,
      category: a.category,
      categoryRoot: a.categoryRoot,
      contentType: a.contentType,
      tags: a.tags,
      wordCount: a.wordCount,
      publishedAt: a.publishedAt,
      pageviewsTotal: a.pageviewsTotal,
      pageviews24h: a.pageviews24h,
      pageviews7d: a.pageviews7d,
      uniqueVisitors: a.uniqueVisitors,
      avgTimeOnPageSec: a.avgTimeOnPageSec,
      readCompletionRate: a.readCompletionRate,
      trendingScore: a.trendingScore,
    },
    series: Array.from({ length: hours }, (_, i) => ({
      hour: new Date(publishedMs + i * 3_600_000).toISOString(),
      // Krivа vesti: nagli vrh u prva dva sata, pa opadanje
      pageviews: Math.round(a.pageviewsTotal * (0.30 * Math.exp(-i / 5) + 0.004) * (0.75 + rand() * 0.5)),
    })),
    sourceBreakdown: sourceBreakdown(a.pageviewsTotal, Number(a.articleId)),
    scrollFunnel: [
      { depth: 25, users: p25, pct: 100 },
      { depth: 50, users: p50, pct: Math.round((p50 / p25) * 100) },
      { depth: 75, users: p75, pct: Math.round((p75 / p25) * 100) },
      { depth: 100, users: p100, pct: Math.round((p100 / p25) * 100) },
    ],
    comparison: {
      categoryPercentile: percentile,
      categoryMedian: peers[Math.floor(peers.length / 2)] ?? 0,
      peersCount: peers.length,
    },
    abTest: a === ARTICLES[0] ? demoAbTest() : null,
  };
}

function articleHeatmap(id) {
  const a = ARTICLES.find((x) => x.articleId === id) ?? ARTICLES[0];
  if (a.pageviewsTotal < 500) {
    return { available: false, reason: 'insufficient_data', pageviews: a.pageviewsTotal, required: 500 };
  }

  const rand = rng(Number(a.articleId) * 3);
  const cells = [];
  // Klikovi se grupišu oko naslova, CTA dugmeta i povezanih tekstova
  const hotspots = [[188, 240], [188, 980], [120, 1720], [255, 1740], [188, 2320]];
  for (const [hx, hy] of hotspots) {
    for (let i = 0; i < 90; i++) {
      const x = Math.max(0, Math.min(370, Math.round(hx + (rand() - 0.5) * 130)));
      const y = Math.max(0, Math.round(hy + (rand() - 0.5) * 210));
      cells.push({ x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, clicks: 1 + Math.round(rand() * 14) });
    }
  }
  const maxClicks = cells.reduce((m, c) => Math.max(m, c.clicks), 0);

  return {
    available: true,
    viewportBucket: 375,
    cellSize: 10,
    maxClicks,
    cells: cells.map((c) => ({ ...c, intensity: Math.round((c.clicks / maxClicks) * 100) / 100 })),
    topSelectors: [
      { selector: 'a.article-card', clicks: 1840 },
      { selector: 'button.cta', clicks: 942 },
      { selector: 'a.related-link', clicks: 617 },
      { selector: 'div.gallery>img', clicks: 388 },
    ],
  };
}

function demoAbTest() {
  return {
    test_id: 'ab_demo0001',
    status: 'running',
    winner_variant: null,
    min_impressions: 1000,
    variants: [
      { variant: 'A', headline: 'Jokić objavio odluku o nastavku karijere', isControl: true, impressions: 640, clicks: 27, ctr: 0.0422, confidence: null, isSignificant: false },
      { variant: 'B', headline: 'Jokić prekinuo ćutanje: Evo šta sledi', isControl: false, impressions: 638, clicks: 48, ctr: 0.0752, confidence: 0.982, isSignificant: false },
    ],
  };
}

function abTests() {
  return {
    tests: [
      {
        testId: 'ab_demo0001',
        articleId: ARTICLES[0].articleId,
        articleTitle: ARTICLES[0].title,
        status: 'running',
        autoPromote: false,
        minImpressions: 1000,
        createdAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
        completedAt: null,
        variants: [
          { variant: 'A', headline: 'Jokić objavio odluku o nastavku karijere', isControl: true, impressions: 640, clicks: 27, ctr: 4.22, confidence: null, isSignificant: false },
          { variant: 'B', headline: 'Jokić prekinuo ćutanje: Evo šta sledi', isControl: false, impressions: 638, clicks: 48, ctr: 7.52, confidence: 0.982, isSignificant: false },
        ],
        // Ispod praga: 98,2% konfidencije, ali nema 1000 prikaza -> nema pobednika
        winner: null,
        hasEnoughData: false,
        statusText: 'Još nema dovoljno podataka',
        impressionsNeeded: 362,
      },
      {
        testId: 'ab_demo0002',
        articleId: ARTICLES[1].articleId,
        articleTitle: ARTICLES[1].title,
        status: 'running',
        autoPromote: false,
        minImpressions: 1000,
        createdAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
        completedAt: null,
        variants: [
          { variant: 'A', headline: 'Zvezda ubedljiva u derbiju, Partizan bez odgovora', isControl: true, impressions: 12_400, clicks: 508, ctr: 4.10, confidence: null, isSignificant: false },
          { variant: 'B', headline: 'Derbi bez istorije: Zvezda pregazila Partizan', isControl: false, impressions: 12_380, clicks: 793, ctr: 6.41, confidence: 0.9999, isSignificant: true },
        ],
        winner: 'B',
        hasEnoughData: true,
        statusText: 'Pobednik je utvrđen',
        impressionsNeeded: 0,
      },
    ],
  };
}

function alerts() {
  const mk = (minutesAgo, pv, mult, driver, resolved) => ({
    id: minutesAgo,
    site: 'rs',
    detected_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    minute_utc: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    pageviews_per_min: pv,
    baseline_per_min: Math.round((pv / mult) * 10) / 10,
    multiplier: mult,
    driver_type: 'article',
    driver_value: driver,
    driver_pageviews: Math.round(pv * 1.8),
    notified: true,
    resolved_at: resolved ? new Date(Date.now() - (minutesAgo - 20) * 60_000).toISOString() : null,
  });
  return {
    alerts: [
      mk(6, 1840, 4.2, ARTICLES[0].title, false),
      mk(1_450, 2310, 5.1, ARTICLES[1].title, true),
      mk(2_890, 1520, 3.4, ARTICLES[2].title, true),
      mk(5_600, 1290, 3.1, ARTICLES[3].title, true),
    ],
  };
}

// ── Ruter ───────────────────────────────────────────────────────────────────

/**
 * Mapira putanju API-ja na demo odgovor.
 * @param {string} path npr. "/overview?days=7"
 */
export function demoResponse(path) {
  const [rawPath, qs = ''] = path.split('?');
  const q = new URLSearchParams(qs);
  const days = Math.min(90, Math.max(1, Number(q.get('days')) || 7));
  const parts = rawPath.split('/').filter(Boolean);

  switch (parts[0]) {
    case 'overview': return overview(days);
    case 'realtime': return realtime();
    case 'alerts': return alerts();

    case 'authors':
      if (parts[1] === 'periods') return { period: 'week', rows: [] };
      if (parts[1]) return authorDetail(decodeURIComponent(parts[1]), days);
      return authors(days);

    case 'categories':
      if (parts[1] === 'channels') return categoryChannels(days);
      if (parts[1] === 'compare') {
        const names = (q.get('categories') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        return categoryCompare(days, names);
      }
      return categories(days, q.get('root'));

    case 'tags':
      if (parts[1] === 'trending') return tagsTrending();
      if (parts[1]) return tagDetail(decodeURIComponent(parts[1]), days);
      return tags(days);

    case 'articles':
      if (parts[2] === 'heatmap') return articleHeatmap(parts[1]);
      if (parts[1]) return articleDetail(parts[1]);
      return articles(q);

    case 'sources':
      if (parts[1] === 'timeseries') return sourcesTimeseries(days);
      if (parts[1] === 'discover') return sourcesDiscover(days);
      if (parts[1] === 'devices') return sourcesDevices(days);
      if (parts[1] === 'campaigns') return sourcesCampaigns(days);
      return sources(days);

    case 'ab': return abTests();

    case 'geo': {
      const total = DAILY_PAGEVIEWS * days;
      const rows = geoRows(total, days * 5 + 3);

      if (parts[1] === 'cities') {
        const country = q.get('country');
        return {
          range: range(days),
          cities: rows.filter((r) => !country || r.country === country)
            .sort((a, b) => b.pageviews - a.pageviews),
        };
      }

      if (parts[1] === 'channels') {
        const totals = new Map();
        for (const r of rows) totals.set(r.country, (totals.get(r.country) ?? 0) + r.pageviews);
        return {
          range: range(days),
          sources: SOURCES.map((s) => s.source),
          rows: [...totals].map(([country, tot]) => {
            // Dijaspora dolazi drugacije: vise Discover-a i direktnog, manje pretrage
            const bias = country === 'RS'
              ? {}
              : { google_discover: 1.6, direct: 1.4, search_organic: 0.7 };
            const bySource = {};
            for (const x of biasedSources(tot, country.charCodeAt(0) + country.charCodeAt(1), bias)) {
              bySource[x.source] = x.pageviews;
            }
            return {
              country,
              total: tot,
              bySource,
              shares: Object.fromEntries(Object.entries(bySource)
                .map(([k, v]) => [k, tot > 0 ? Math.round((v / tot) * 1000) / 10 : 0])),
            };
          }).sort((a, b) => b.total - a.total),
        };
      }

      const totals = new Map();
      for (const r of rows) {
        const cur = totals.get(r.country) ?? { pageviews: 0, uniqueVisitors: 0 };
        cur.pageviews += r.pageviews;
        cur.uniqueVisitors += r.uniqueVisitors;
        totals.set(r.country, cur);
      }
      const grand = [...totals.values()].reduce((a, b) => a + b.pageviews, 0);
      return {
        range: range(days),
        total: grand,
        countries: [...totals].map(([country, v]) => ({
          country,
          pageviews: v.pageviews,
          sessions: Math.round(v.pageviews / 1.8),
          uniqueVisitors: v.uniqueVisitors,
          share: grand > 0 ? Math.round((v.pageviews / grand) * 1000) / 10 : 0,
        })).sort((a, b) => b.pageviews - a.pageviews),
      };
    }

    case 'channels': {
      const dimension = q.get('dimension') ?? 'author';
      const entity = q.get('entity');
      const total = DAILY_PAGEVIEWS * days;

      const entities = dimension === 'author' ? AUTHORS
        : dimension === 'category' ? CATEGORIES.map((c) => c.full)
          : TAGS;

      let rows = entities.map((name, i) => {
        const share = dimension === 'tag' ? Math.max(0.02, 0.09 - i * 0.005) : 1 / entities.length;
        const tot = Math.max(500, Math.round(total * share));
        const bias = CHANNEL_BIAS[name] ?? CHANNEL_BIAS[CATEGORIES[i % CATEGORIES.length].full];
        const list = biasedSources(tot, name.length * 13 + i, bias);
        const bySource = {};
        for (const x of list) bySource[x.source] = x.pageviews;
        const top = list[0];
        return {
          entity: name,
          total: tot,
          bySource,
          shares: Object.fromEntries(list.map((x) => [x.source, Math.round((x.pageviews / tot) * 1000) / 10])),
          topSource: top ? top.source : null,
          topShare: top ? Math.round((top.pageviews / tot) * 1000) / 10 : 0,
        };
      }).sort((a, b) => b.total - a.total);

      if (entity) rows = rows.filter((r) => r.entity === entity);

      const siteTotals = {};
      for (const r of rows) {
        for (const [k, v] of Object.entries(r.bySource)) siteTotals[k] = (siteTotals[k] ?? 0) + v;
      }
      const siteTotal = Object.values(siteTotals).reduce((a, b) => a + b, 0);

      return {
        dimension,
        dimensionLabel: { author: 'Autor', category: 'Kategorija', tag: 'Tag' }[dimension],
        range: range(days),
        sources: SOURCES.map((s) => ({
          source: s.source,
          label: s.label,
          pageviews: siteTotals[s.source] ?? 0,
          share: siteTotal > 0 ? Math.round(((siteTotals[s.source] ?? 0) / siteTotal) * 1000) / 10 : 0,
        })).sort((a, b) => b.pageviews - a.pageviews),
        rows,
      };
    }

    case 'auth':
      if (parts[1] === 'me') return { user: DEMO_USER };
      return { ok: true };

    default:
      return {};
  }
}
