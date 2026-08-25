/**
 * Traffic source attribution - sekcija 5.
 *
 * Ovo je jedna od kljucnih funkcija platforme i mora biti tacna, pa je
 * napisana kao cista funkcija bez I/O, sa unit testom za svaki slucaj iz
 * specifikacije (packages/shared/test/traffic-source.test.js).
 *
 * Prioritet je striktno onaj iz sekcije 5.1 - ukljucujuci to da UTM izvor
 * (korak 2) ima prednost nad gclid/fbclid (korak 3).
 */

export const SOURCES = Object.freeze({
  PAID: 'paid',
  SEARCH_ORGANIC: 'search_organic',
  GOOGLE_DISCOVER: 'google_discover',
  SOCIAL_META: 'social_meta',
  SOCIAL_X: 'social_x',
  SOCIAL_TIKTOK: 'social_tiktok',
  SOCIAL_YOUTUBE: 'social_youtube',
  SOCIAL_REDDIT: 'social_reddit',
  INTERNAL: 'internal',
  REFERRAL: 'referral',
  DIRECT: 'direct',
  // Dodaci van osnovne liste iz sekcije 5.1: sekcija 5.2 trazi da se
  // newsletter i app deep linkovi UTM-uju kako bi izasli iz "laznog direct-a",
  // sto je besmisleno ako nemaju svoj kanal.
  EMAIL: 'email',
  MESSAGING: 'messaging',
  APP: 'app',
});

const PAID_MEDIUMS = new Set([
  'cpc', 'ppc', 'paid', 'paidsocial', 'paid_social', 'paid-social',
  'display', 'banner', 'cpm', 'retargeting',
]);

/** utm_source -> kanal (korak 2 iz sekcije 5.1) */
const UTM_SOURCE_MAP = new Map(Object.entries({
  facebook: SOURCES.SOCIAL_META,
  fb: SOURCES.SOCIAL_META,
  'facebook.com': SOURCES.SOCIAL_META,
  meta: SOURCES.SOCIAL_META,
  instagram: SOURCES.SOCIAL_META,
  ig: SOURCES.SOCIAL_META,
  messenger: SOURCES.SOCIAL_META,

  twitter: SOURCES.SOCIAL_X,
  x: SOURCES.SOCIAL_X,
  'x.com': SOURCES.SOCIAL_X,

  tiktok: SOURCES.SOCIAL_TIKTOK,
  youtube: SOURCES.SOCIAL_YOUTUBE,
  yt: SOURCES.SOCIAL_YOUTUBE,
  reddit: SOURCES.SOCIAL_REDDIT,

  google: SOURCES.SEARCH_ORGANIC,
  bing: SOURCES.SEARCH_ORGANIC,
  yandex: SOURCES.SEARCH_ORGANIC,
  duckduckgo: SOURCES.SEARCH_ORGANIC,

  discover: SOURCES.GOOGLE_DISCOVER,
  googlediscover: SOURCES.GOOGLE_DISCOVER,
  'google-discover': SOURCES.GOOGLE_DISCOVER,

  newsletter: SOURCES.EMAIL,
  email: SOURCES.EMAIL,
  mail: SOURCES.EMAIL,
  mailchimp: SOURCES.EMAIL,
  sendgrid: SOURCES.EMAIL,

  viber: SOURCES.MESSAGING,
  whatsapp: SOURCES.MESSAGING,
  telegram: SOURCES.MESSAGING,
  signal: SOURCES.MESSAGING,

  app: SOURCES.APP,
  android: SOURCES.APP,
  ios: SOURCES.APP,
  'native-app': SOURCES.APP,
  arenaapp: SOURCES.APP,
}));

const SEARCH_DOMAINS = new Set([
  'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'yahoo.com',
  'ecosia.org', 'search.brave.com', 'baidu.com', 'seznam.cz', 'qwant.com',
  'startpage.com', 'ask.com', 'aol.com',
]);

const SOCIAL_META_DOMAINS = new Set([
  'facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com',
  'web.facebook.com', 'business.facebook.com',
  'instagram.com', 'l.instagram.com', 'messenger.com', 'threads.net',
]);

const SOCIAL_X_DOMAINS = new Set(['t.co', 'twitter.com', 'x.com', 'mobile.twitter.com']);
const SOCIAL_TIKTOK_DOMAINS = new Set(['tiktok.com', 'vm.tiktok.com', 'm.tiktok.com']);
const SOCIAL_YOUTUBE_DOMAINS = new Set(['youtube.com', 'm.youtube.com', 'youtu.be']);
const SOCIAL_REDDIT_DOMAINS = new Set(['reddit.com', 'old.reddit.com', 'out.reddit.com']);

/** Google Discover / Google News - sekcija 5.3, mora biti odvojeno od organic-a */
const DISCOVER_DOMAINS = new Set([
  'news.google.com',
  'googleapis.com',
  'www.googleapis.com',
  'discover.google.com',
]);
const DISCOVER_APP_REFERRERS = [
  'android-app://com.google.android.googlequicksearchbox',
  'android-app://com.google.android.apps.magazines',
];

const MESSAGING_DOMAINS = new Set([
  'web.whatsapp.com', 'whatsapp.com', 'wa.me',
  'web.telegram.org', 't.me', 'telegram.org',
  'viber.com', 'invite.viber.com',
]);

const EMAIL_DOMAINS = new Set([
  'mail.google.com', 'outlook.live.com', 'outlook.office.com',
  'mail.yahoo.com', 'roundcube.com', 'mail.ru',
]);

/** Skida "www." i lowercase-uje. */
export function normalizeHost(host) {
  if (!host) return '';
  return host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

/**
 * Vadi domen iz referrer stringa. Podrzava i android-app:// sheme,
 * koje su bitne za Discover (sekcija 5.1, korak 4).
 */
export function extractDomain(referrer) {
  if (!referrer || typeof referrer !== 'string') return '';
  const raw = referrer.trim();
  if (!raw) return '';
  if (raw.startsWith('android-app://')) {
    return raw.slice('android-app://'.length).split('/')[0].toLowerCase();
  }
  try {
    return normalizeHost(new URL(raw).hostname);
  } catch {
    // Referrer bez sheme ("facebook.com/xyz")
    const m = raw.match(/^([a-z0-9.-]+\.[a-z]{2,})(?:[/:?#]|$)/i);
    return m ? normalizeHost(m[1]) : '';
  }
}

/** Da li je domen (ili bilo koji njegov roditelj) u setu. */
function matchesDomain(host, set) {
  if (!host) return false;
  if (set.has(host)) return true;
  const parts = host.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    if (set.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}

/** google.rs, google.co.uk, google.com... -> tacno Google pretraga. */
function isGoogleSearchDomain(host) {
  return /^(?:[a-z0-9-]+\.)*google(?:\.[a-z]{2,3}){1,2}$/.test(host);
}
function isYandexDomain(host) {
  return /^(?:[a-z0-9-]+\.)*yandex(?:\.[a-z]{2,3}){1,2}$/.test(host);
}

/**
 * Interni saobracaj: bilo koji od konfigurisanih domena klijenta,
 * ukljucujuci subdomene (m.tvarenasport.com, amp.tvarenasport.hr...).
 */
function isInternal(host, internalDomains) {
  if (!host) return false;
  return internalDomains.some((d) => {
    const nd = normalizeHost(d);
    return host === nd || host.endsWith(`.${nd}`);
  });
}

/** Vadi UTM/klik parametre iz URL-a. Radi i sa relativnim URL-om. */
export function parseUrlParams(url) {
  const out = {
    utm_source: '', utm_medium: '', utm_campaign: '',
    utm_content: '', utm_term: '', gclid: '', fbclid: '', ttclid: '', msclkid: '',
  };
  if (!url) return out;
  try {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    if (!qs) return out;
    const params = new URLSearchParams(qs.split('#')[0]);
    for (const key of Object.keys(out)) {
      const v = params.get(key);
      if (v) out[key] = v.trim().toLowerCase().slice(0, 255);
    }
  } catch {
    /* nikad ne rusi ingestion zbog losem URL-a */
  }
  return out;
}

/**
 * Glavna funkcija.
 *
 * @param {object} input
 * @param {string} [input.url]        puni URL stranice (za UTM/gclid ako SDK nije poslao)
 * @param {string} [input.referrer]   document.referrer
 * @param {object} [input.utm]        vec isparsirani UTM parametri (imaju prednost)
 * @param {string[]} [input.internalDomains]
 * @returns {{traffic_source: string, channel_detail: string, referrer_domain: string,
 *            utm_source: string, utm_medium: string, utm_campaign: string}}
 */
export function resolveTrafficSource(input = {}) {
  const { url = '', referrer = '', internalDomains = [] } = input;

  const fromUrl = parseUrlParams(url);
  const utm = { ...fromUrl, ...(input.utm ?? {}) };

  const utmSource = (utm.utm_source || '').toLowerCase().trim();
  const utmMedium = (utm.utm_medium || '').toLowerCase().trim();
  const utmCampaign = (utm.utm_campaign || '').trim();
  const hasClickId = Boolean(utm.gclid || utm.fbclid || utm.ttclid || utm.msclkid);

  const referrerDomain = extractDomain(referrer);

  const base = {
    referrer_domain: referrerDomain,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  };

  // 1. Placeni medium
  if (utmMedium && PAID_MEDIUMS.has(utmMedium)) {
    return { ...base, traffic_source: SOURCES.PAID, channel_detail: utmSource || referrerDomain };
  }

  // 2. UTM izvor bez paid medium-a
  if (utmSource) {
    const mapped = UTM_SOURCE_MAP.get(utmSource) ?? SOURCES.REFERRAL;
    return { ...base, traffic_source: mapped, channel_detail: utmCampaign || utmSource };
  }

  // 3. Klik ID bez UTM-a -> placeni klik
  if (hasClickId) {
    const network = utm.gclid ? 'google_ads'
      : utm.fbclid ? 'meta_ads'
      : utm.ttclid ? 'tiktok_ads'
      : 'microsoft_ads';
    return { ...base, traffic_source: SOURCES.PAID, channel_detail: network };
  }

  // 4. Referrer domain matching
  if (referrerDomain) {
    if (isInternal(referrerDomain, internalDomains)) {
      return { ...base, traffic_source: SOURCES.INTERNAL, channel_detail: referrerDomain };
    }
    if (DISCOVER_APP_REFERRERS.some((p) => referrer.startsWith(p))
        || matchesDomain(referrerDomain, DISCOVER_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.GOOGLE_DISCOVER, channel_detail: referrerDomain };
    }
    if (isGoogleSearchDomain(referrerDomain) || isYandexDomain(referrerDomain)
        || matchesDomain(referrerDomain, SEARCH_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SEARCH_ORGANIC, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, SOCIAL_META_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SOCIAL_META, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, SOCIAL_X_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SOCIAL_X, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, SOCIAL_TIKTOK_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SOCIAL_TIKTOK, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, SOCIAL_YOUTUBE_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SOCIAL_YOUTUBE, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, SOCIAL_REDDIT_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.SOCIAL_REDDIT, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, MESSAGING_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.MESSAGING, channel_detail: referrerDomain };
    }
    if (matchesDomain(referrerDomain, EMAIL_DOMAINS)) {
      return { ...base, traffic_source: SOURCES.EMAIL, channel_detail: referrerDomain };
    }
    return { ...base, traffic_source: SOURCES.REFERRAL, channel_detail: referrerDomain };
  }

  // 5. Nema referrer-a, nema UTM-a
  return { ...base, traffic_source: SOURCES.DIRECT, channel_detail: '' };
}

/** Ljudski citljive labele za dashboard. */
export const SOURCE_LABELS = Object.freeze({
  paid: 'Plaćeni saobraćaj',
  search_organic: 'Organska pretraga',
  google_discover: 'Google Discover',
  social_meta: 'Facebook / Instagram',
  social_x: 'X (Twitter)',
  social_tiktok: 'TikTok',
  social_youtube: 'YouTube',
  social_reddit: 'Reddit',
  internal: 'Interni',
  referral: 'Referral',
  direct: 'Direktan',
  email: 'Email / Newsletter',
  messaging: 'Poruke (Viber/WhatsApp)',
  app: 'Aplikacija',
});
