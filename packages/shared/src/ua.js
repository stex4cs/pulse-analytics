/**
 * User-Agent parsing i bot detekcija (sekcija 3.3 i 4.2).
 *
 * Namerno bez npm zavisnosti: ovo se izvrsava na svakom eventu, do 2000 req/s
 * na peak-u, a pune UA biblioteke rade stotine regex-a po pozivu. Ovde je
 * ~15 regex-a sa keširanjem rezultata po UA stringu.
 */

const BOT_PATTERNS = [
  /bot\b/i, /\bbots\b/i, /spider/i, /crawl/i, /slurp/i, /archiver/i,
  /googlebot/i, /bingbot/i, /yandex(bot|images)/i, /duckduckbot/i, /baiduspider/i,
  /ahrefsbot/i, /semrushbot/i, /mj12bot/i, /dotbot/i, /petalbot/i, /applebot/i,
  /facebookexternalhit/i, /facebookcatalog/i, /twitterbot/i, /linkedinbot/i,
  /telegrambot/i, /whatsapp/i, /viberbot/i, /discordbot/i, /slackbot/i,
  /embedly/i, /quora link preview/i, /pinterest/i, /redditbot/i,
  /google-inspectiontool/i, /google page speed/i, /lighthouse/i, /gtmetrix/i,
  /pingdom/i, /uptimerobot/i, /statuscake/i, /site24x7/i, /datadog/i,
  /headlesschrome/i, /phantomjs/i, /puppeteer/i, /playwright/i, /selenium/i,
  /python-requests/i, /axios\//i, /node-fetch/i, /go-http-client/i, /okhttp/i,
  /curl\//i, /wget/i, /libwww-perl/i, /java\/\d/i, /scrapy/i, /httpclient/i,
  /chatgpt-user/i, /gptbot/i, /claudebot/i, /anthropic-ai/i, /perplexitybot/i,
  /ccbot/i, /bytespider/i, /amazonbot/i, /meta-externalagent/i,
];

export const BOT_REASONS = Object.freeze({
  UA_BLACKLIST: 'ua_blacklist',
  HEADLESS: 'headless',
  RATE: 'rate',
  NO_SESSION: 'no_session',
  EMPTY_UA: 'empty_ua',
});

const BROWSERS = [
  [/edg(?:e|a|ios)?\/([\d.]+)/i, 'Edge'],
  [/opr\/([\d.]+)/i, 'Opera'],
  [/opera[\s/]([\d.]+)/i, 'Opera'],
  [/samsungbrowser\/([\d.]+)/i, 'Samsung Internet'],
  [/ucbrowser\/([\d.]+)/i, 'UC Browser'],
  [/yabrowser\/([\d.]+)/i, 'Yandex Browser'],
  [/firefox\/([\d.]+)/i, 'Firefox'],
  [/fxios\/([\d.]+)/i, 'Firefox'],
  [/crios\/([\d.]+)/i, 'Chrome'],
  [/chrome\/([\d.]+)/i, 'Chrome'],
  [/version\/([\d.]+).*safari/i, 'Safari'],
  [/safari\/([\d.]+)/i, 'Safari'],
  [/msie\s([\d.]+)/i, 'IE'],
  [/trident\/.*rv:([\d.]+)/i, 'IE'],
];

const OSES = [
  [/windows nt 10\.0/i, 'Windows 10/11'],
  [/windows nt 6\.3/i, 'Windows 8.1'],
  [/windows nt 6\.1/i, 'Windows 7'],
  [/windows phone/i, 'Windows Phone'],
  [/windows/i, 'Windows'],
  [/android\s([\d.]+)/i, 'Android'],
  [/android/i, 'Android'],
  [/(?:iphone|ipad|ipod).*os\s([\d_]+)/i, 'iOS'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/mac os x/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/linux/i, 'Linux'],
];

const TABLET_RE = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i;
const MOBILE_RE = /mobile|iphone|ipod|android.*mobile|blackberry|iemobile|opera mini|windows phone/i;
const TV_RE = /smart-?tv|hbbtv|appletv|googletv|netcast|webos.*tv|tizen.*tv|roku|crkey/i;

const cache = new Map();
const CACHE_MAX = 5000;

/**
 * @param {string} ua
 * @returns {{device_type: string, browser: string, os: string, is_bot: boolean, bot_reason: string}}
 */
export function parseUserAgent(ua) {
  const key = (ua ?? '').slice(0, 300);
  const hit = cache.get(key);
  if (hit) return hit;

  const result = compute(key);

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, result);
  return result;
}

function compute(ua) {
  if (!ua) {
    return { device_type: 'unknown', browser: 'unknown', os: 'unknown', is_bot: true, bot_reason: BOT_REASONS.EMPTY_UA };
  }

  for (const re of BOT_PATTERNS) {
    if (re.test(ua)) {
      const headless = /headlesschrome|phantomjs|puppeteer|playwright|selenium/i.test(ua);
      return {
        device_type: 'bot',
        browser: 'bot',
        os: 'bot',
        is_bot: true,
        bot_reason: headless ? BOT_REASONS.HEADLESS : BOT_REASONS.UA_BLACKLIST,
      };
    }
  }

  let browser = 'other';
  for (const [re, name] of BROWSERS) {
    const m = ua.match(re);
    if (m) {
      const major = (m[1] ?? '').split('.')[0];
      browser = major ? `${name} ${major}` : name;
      break;
    }
  }

  let os = 'other';
  for (const [re, name] of OSES) {
    if (re.test(ua)) { os = name; break; }
  }

  let device_type = 'desktop';
  if (TV_RE.test(ua)) device_type = 'tv';
  else if (TABLET_RE.test(ua) && !MOBILE_RE.test(ua)) device_type = 'tablet';
  else if (MOBILE_RE.test(ua)) device_type = 'mobile';

  return { device_type, browser, os, is_bot: false, bot_reason: '' };
}

/** Bucket-i za heatmapu (sekcija 9.1). */
const VIEWPORT_BUCKETS = [320, 375, 414, 768, 1024, 1440, 1920];

export function viewportBucket(width) {
  const w = Number(width) || 0;
  if (w <= 0) return 0;
  let chosen = VIEWPORT_BUCKETS[0];
  for (const b of VIEWPORT_BUCKETS) {
    if (w >= b) chosen = b;
  }
  return chosen;
}

export { VIEWPORT_BUCKETS };
