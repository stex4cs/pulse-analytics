/**
 * Event sema: validacija i normalizacija (sekcija 3.2, 4.2 tacka 5).
 *
 * Pravilo: nikad ne bacamo izuzetak ka klijentu. Losi eventi se odbacuju,
 * broje i loguju - /collect uvek vraca 204 (sekcija 4.1).
 */

export const EVENT_TYPES = Object.freeze([
  'pageview',
  'scroll_depth',
  'time_on_page',
  'click',
  'video_play',
  'video_progress',
  'live_blog_update',
  'ab_exposure',
]);

export const CONTENT_TYPES = Object.freeze([
  'news', 'live-blog', 'video', 'column', 'static', 'homepage', 'category', 'other',
]);

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const CONTENT_TYPE_SET = new Set(CONTENT_TYPES);

/** Redosled kolona odgovara pulse.events - worker salje JSONEachRow. */
export const EVENT_COLUMNS = Object.freeze([
  'event_id', 'event_type', 'timestamp', 'client_timestamp', 'clock_skew_ms',
  'session_id', 'visitor_id', 'is_new_visitor', 'has_consent',
  'site', 'url', 'path', 'article_id', 'title', 'author', 'category', 'tags',
  'content_type', 'published_at', 'word_count',
  'referrer_domain', 'traffic_source', 'channel_detail',
  'utm_source', 'utm_medium', 'utm_campaign',
  'device_type', 'browser', 'os', 'country', 'city', 'ip_hash',
  'scroll_depth', 'active_time_ms', 'click_selector', 'click_x', 'click_y',
  'viewport_width', 'viewport_bucket', 'video_progress', 'ab_test_id', 'ab_variant',
  'is_bot', 'bot_reason',
]);

const MAX = {
  url: 2048, path: 512, article_id: 40, title: 300, author: 120, category: 200,
  tag: 160, tags: 25, click_selector: 255, channel_detail: 255,
  utm: 255, city: 120, session_id: 64, visitor_id: 64, ab_id: 64, ab_variant: 32,
};

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampInt = (v, min, max) => {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
};

/** ClickHouse DateTime64(3) prima 'YYYY-MM-DD HH:MM:SS.mmm'. */
export function toClickHouseDateTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').replace('Z', '');
}

/** Nullable(DateTime) -> 'YYYY-MM-DD HH:MM:SS' ili null. */
export function toClickHouseDate(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/**
 * Validacija sirovog eventa koji je stigao od SDK-a.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function validateRawEvent(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not_an_object' };
  if (!EVENT_TYPE_SET.has(raw.type ?? raw.event_type)) return { ok: false, reason: 'unknown_event_type' };
  if (typeof raw.sid !== 'string' || raw.sid.length < 8) return { ok: false, reason: 'missing_session_id' };
  if (typeof raw.url !== 'string' || !raw.url) return { ok: false, reason: 'missing_url' };

  const ts = Number(raw.ts);
  if (!Number.isFinite(ts) || ts < 946684800000) return { ok: false, reason: 'bad_timestamp' };

  const type = raw.type ?? raw.event_type;
  if (type === 'scroll_depth' && ![25, 50, 75, 100].includes(Number(raw.depth))) {
    return { ok: false, reason: 'bad_scroll_depth' };
  }
  if (type === 'ab_exposure' && (!raw.abTestId || !raw.abVariant)) {
    return { ok: false, reason: 'missing_ab_fields' };
  }
  return { ok: true };
}

/**
 * Pretvara sirovi SDK event + server kontekst u red za ClickHouse.
 *
 * @param {object} raw        telo eventa iz /collect
 * @param {object} ctx        server-side kontekst
 * @param {number} ctx.serverTimeMs  autoritativno vreme (sekcija 3.2)
 * @param {string} ctx.eventId
 * @param {object} ctx.geo    { country, city }
 * @param {object} ctx.ua     rezultat parseUserAgent
 * @param {object} ctx.source rezultat resolveTrafficSource
 * @param {string} ctx.ipHash
 * @param {boolean} ctx.isBot
 * @param {string} ctx.botReason
 * @param {string} ctx.site
 */
export function buildEventRow(raw, ctx) {
  const type = raw.type ?? raw.event_type;
  const meta = raw.meta ?? {};
  const clientTs = Number(raw.ts) || ctx.serverTimeMs;
  const skew = clampInt(clientTs - ctx.serverTimeMs, -2_147_483_648, 2_147_483_647);

  let path = '';
  try {
    path = new URL(raw.url).pathname;
  } catch {
    path = str(raw.url, MAX.path).split('?')[0];
  }

  const hasConsent = raw.consent === true || raw.consent === 1;
  const viewportWidth = clampInt(raw.vw, 0, 65535);

  const tags = Array.isArray(meta.tags)
    ? meta.tags.filter((t) => typeof t === 'string' && t).slice(0, MAX.tags).map((t) => t.slice(0, MAX.tag))
    : [];

  const contentType = CONTENT_TYPE_SET.has(meta.contentType) ? meta.contentType : 'other';

  return {
    event_id: ctx.eventId,
    event_type: type,
    // Server timestamp je autoritativan (sekcija 3.2)
    timestamp: toClickHouseDateTime(ctx.serverTimeMs),
    client_timestamp: toClickHouseDateTime(clientTs),
    clock_skew_ms: skew,

    session_id: str(raw.sid, MAX.session_id),
    // Bez consent-a nema dugorocnog ID-a (sekcija 12.1)
    visitor_id: hasConsent ? str(raw.vid, MAX.visitor_id) : '',
    is_new_visitor: raw.new === true || raw.new === 1 ? 1 : 0,
    has_consent: hasConsent ? 1 : 0,

    site: ctx.site,
    url: str(raw.url, MAX.url),
    path: path.slice(0, MAX.path),
    article_id: str(meta.articleId, MAX.article_id),
    title: str(meta.title, MAX.title),
    author: str(meta.author, MAX.author),
    category: str(meta.category, MAX.category),
    tags,
    content_type: contentType,
    published_at: toClickHouseDate(meta.publishedAt),
    word_count: clampInt(meta.wordCount, 0, 65535),

    referrer_domain: str(ctx.source.referrer_domain, 200),
    traffic_source: ctx.source.traffic_source,
    channel_detail: str(ctx.source.channel_detail, MAX.channel_detail),
    utm_source: str(ctx.source.utm_source, MAX.utm),
    utm_medium: str(ctx.source.utm_medium, MAX.utm),
    utm_campaign: str(ctx.source.utm_campaign, MAX.utm),

    device_type: ctx.ua.device_type,
    browser: ctx.ua.browser,
    os: ctx.ua.os,
    country: str(ctx.geo.country, 4),
    city: str(ctx.geo.city, MAX.city),
    ip_hash: ctx.ipHash,

    scroll_depth: type === 'scroll_depth' ? clampInt(raw.depth, 0, 100) : 0,
    active_time_ms: clampInt(raw.activeMs, 0, 4_294_967_295),
    // Klik koordinate samo uz consent (sekcija 12.1 - bez heatmape bez consent-a)
    click_selector: type === 'click' && hasConsent ? str(raw.selector, MAX.click_selector) : '',
    click_x: type === 'click' && hasConsent ? clampInt(raw.x, 0, 65535) : 0,
    click_y: type === 'click' && hasConsent ? clampInt(raw.y, 0, 65535) : 0,
    viewport_width: viewportWidth,
    viewport_bucket: clampInt(ctx.viewportBucket ?? 0, 0, 65535),
    video_progress: type === 'video_progress' ? clampInt(raw.progress, 0, 100) : 0,
    ab_test_id: str(raw.abTestId, MAX.ab_id),
    ab_variant: str(raw.abVariant, MAX.ab_variant),

    is_bot: ctx.isBot ? 1 : 0,
    bot_reason: str(ctx.botReason, 40),
  };
}
