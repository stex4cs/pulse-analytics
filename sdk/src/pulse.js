/**
 * Pulse tracking SDK (sekcija 3).
 *
 * Pravila:
 *  - nikad ne sme da sruši stranicu: sve je u try/catch
 *  - nikad blocking: učitava se async, šalje preko sendBeacon
 *  - bez consent-a radi cookieless (bez visitor_id, bez heatmape)
 *
 * Javni API (window.pulse):
 *   pulse.consent(true|false)   - postavlja/povlači consent
 *   pulse.page(meta?)           - ručni pageview (SPA navigacija)
 *   pulse.track(type, data)     - proizvoljan event
 *   pulse.abExposure(id, variant)
 *   pulse.flush()
 */
(function (window, document) {
  'use strict';

  if (window.pulse && window.pulse.__loaded) return;

  // ── Konfiguracija ─────────────────────────────────────────────────────────
  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script');
    return all[all.length - 1];
  }());

  var cfg = window.pulseConfig || {};
  var endpoint = cfg.endpoint || (script && script.getAttribute('data-endpoint'))
    || 'https://pulse.tvarenasport.com/collect';
  var site = cfg.site || (script && script.getAttribute('data-site')) || '';
  var flushMs = Number(cfg.flushMs || 5000);
  var maxBatch = 50;

  var SS = 'pulse_sid';
  var SS_TS = 'pulse_sts';
  var LS_VID = 'pulse_vid';
  var LS_CONSENT = 'pulse_consent';
  var SESSION_TTL = 30 * 60 * 1000;   // 30 min neaktivnosti
  var VISITOR_TTL = 365 * 24 * 3600 * 1000;

  // ── Sitni pomoćnici ───────────────────────────────────────────────────────
  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function uid() {
    return safe(function () {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
      var b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      return Array.prototype.map.call(b, function (x) {
        return ('0' + x.toString(16)).slice(-2);
      }).join('');
    }, String(Date.now()) + Math.random().toString(36).slice(2));
  }

  function store(type, key, value) {
    return safe(function () {
      var s = type === 'l' ? window.localStorage : window.sessionStorage;
      if (value === undefined) return s.getItem(key);
      if (value === null) { s.removeItem(key); return null; }
      s.setItem(key, value);
      return value;
    }, null);
  }

  // ── Consent (sekcija 12.1) ────────────────────────────────────────────────
  var consent = store('l', LS_CONSENT) === '1';

  // ── Identitet ─────────────────────────────────────────────────────────────
  var isNewVisitor = false;

  function sessionId() {
    var now = Date.now();
    var id = store('s', SS);
    var last = Number(store('s', SS_TS) || 0);

    if (!id || (now - last) > SESSION_TTL) {
      id = 's' + uid().replace(/-/g, '').slice(0, 24);
      store('s', SS, id);
    }
    store('s', SS_TS, String(now));
    return id;
  }

  function visitorId() {
    if (!consent) return '';
    var raw = store('l', LS_VID);
    var now = Date.now();

    if (raw) {
      var parts = raw.split('.');
      if (parts.length === 2 && (now - Number(parts[1])) < VISITOR_TTL) {
        store('l', LS_VID, parts[0] + '.' + now);
        return parts[0];
      }
    }
    var id = 'v' + uid().replace(/-/g, '').slice(0, 24);
    store('l', LS_VID, id + '.' + now);
    isNewVisitor = true;
    return id;
  }

  // ── Meta podaci sa stranice (sekcija 3.2) ─────────────────────────────────
  function pageMeta(override) {
    var m = override || window.pulseMeta || {};
    return {
      articleId: m.articleId ? String(m.articleId) : '',
      title: m.title ? String(m.title) : safe(function () { return document.title; }, ''),
      author: m.author ? String(m.author) : '',
      category: m.category ? String(m.category) : '',
      tags: Array.isArray(m.tags) ? m.tags.slice(0, 25) : [],
      publishedAt: m.publishedAt || null,
      contentType: m.contentType || 'other',
      wordCount: Number(m.wordCount) || 0
    };
  }

  // ── Red za slanje ─────────────────────────────────────────────────────────
  var queue = [];
  var timer = null;
  var currentMeta = pageMeta();

  function envelope(events) {
    return {
      v: 1,
      site: site,
      sid: sessionId(),
      vid: visitorId(),
      new: isNewVisitor ? 1 : 0,
      consent: consent ? 1 : 0,
      url: safe(function () { return location.href; }, ''),
      ref: safe(function () { return document.referrer; }, ''),
      vw: safe(function () { return window.innerWidth; }, 0),
      vh: safe(function () { return window.innerHeight; }, 0),
      sw: safe(function () { return screen.width; }, 0),
      wd: safe(function () { return navigator.webdriver ? 1 : 0; }, 0),
      meta: currentMeta,
      events: events
    };
  }

  function send(events, useBeacon) {
    if (!events.length) return;
    var body = JSON.stringify(envelope(events));

    safe(function () {
      if (useBeacon && navigator.sendBeacon) {
        // text/plain izbegava CORS preflight; server ga parsira kao JSON
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
      fetch(endpoint, {
        method: 'POST',
        body: body,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
        credentials: 'omit',
        mode: 'cors'
      })['catch'](function () { /* gubitak eventa ne sme da bude vidljiv korisniku */ });
    });
  }

  function flush(useBeacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    var batch = queue.splice(0, maxBatch);
    send(batch, useBeacon === true);
    if (queue.length) schedule();
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; flush(false); }, flushMs);
  }

  function track(type, data) {
    safe(function () {
      var evt = data || {};
      evt.type = type;
      evt.ts = Date.now();
      queue.push(evt);
      if (queue.length >= maxBatch) flush(false);
      else schedule();
    });
  }

  // ── Aktivno vreme na stranici (sekcija 3.2) ───────────────────────────────
  var activeMs = 0;
  var lastTick = Date.now();
  var visible = safe(function () { return document.visibilityState === 'visible'; }, true);

  function tickActive() {
    var now = Date.now();
    if (visible) activeMs += now - lastTick;
    lastTick = now;
  }

  // ── Scroll depth (25/50/75/100, svaki jednom) ─────────────────────────────
  var scrollSent = {};
  var maxDepth = 0;

  function checkScroll() {
    safe(function () {
      var doc = document.documentElement;
      var body = document.body;
      var height = Math.max(
        body.scrollHeight, doc.scrollHeight, body.offsetHeight, doc.offsetHeight
      );
      if (height <= 0) return;

      var scrolled = (window.pageYOffset || doc.scrollTop) + window.innerHeight;
      var pct = Math.min(100, Math.round((scrolled / height) * 100));
      if (pct > maxDepth) maxDepth = pct;

      var marks = [25, 50, 75, 100];
      for (var i = 0; i < marks.length; i++) {
        var mark = marks[i];
        if (pct >= mark && !scrollSent[mark]) {
          scrollSent[mark] = 1;
          track('scroll_depth', { depth: mark });
        }
      }
    });
  }

  // ── Klik tracking (delegirano) ────────────────────────────────────────────
  function selectorFor(el) {
    return safe(function () {
      var parts = [];
      var node = el;
      var hops = 0;
      while (node && node.nodeType === 1 && hops < 3) {
        var part = node.tagName.toLowerCase();
        if (node.id) { parts.unshift(part + '#' + node.id); break; }
        if (node.className && typeof node.className === 'string') {
          var cls = node.className.trim().split(/\s+/).slice(0, 2).join('.');
          if (cls) part += '.' + cls;
        }
        parts.unshift(part);
        node = node.parentNode;
        hops++;
      }
      return parts.join('>').slice(0, 255);
    }, '');
  }

  function isOutbound(href) {
    return safe(function () {
      if (!href || href.indexOf('http') !== 0) return false;
      return new URL(href).hostname !== location.hostname;
    }, false);
  }

  function onClick(e) {
    safe(function () {
      var target = e.target;
      var anchor = target.closest ? target.closest('a,button,[data-pulse-cta]') : null;
      if (!anchor) return;

      var href = anchor.getAttribute && anchor.getAttribute('href');
      var data = {
        selector: selectorFor(anchor),
        // Koordinate u odnosu na dokument - heatmapa se crta preko cele stranice
        x: Math.round(e.pageX || 0),
        y: Math.round(e.pageY || 0),
        outbound: isOutbound(href) ? 1 : 0
      };

      var abTest = anchor.getAttribute && anchor.getAttribute('data-pulse-ab-test');
      if (abTest) {
        data.abTestId = abTest;
        data.abVariant = anchor.getAttribute('data-pulse-ab-variant') || '';
      }
      track('click', data);
    });
  }

  // ── Video (sekcija 3.2) ───────────────────────────────────────────────────
  var videoMarks = {};

  function attachVideo(video) {
    safe(function () {
      if (video.__pulse) return;
      video.__pulse = 1;
      var key = video.getAttribute('data-pulse-video') || video.currentSrc || 'video';
      videoMarks[key] = {};

      video.addEventListener('play', function () {
        track('video_play', {});
      }, { passive: true });

      video.addEventListener('timeupdate', function () {
        safe(function () {
          if (!video.duration || !isFinite(video.duration)) return;
          var pct = Math.round((video.currentTime / video.duration) * 100);
          var marks = [25, 50, 75, 100];
          for (var i = 0; i < marks.length; i++) {
            if (pct >= marks[i] && !videoMarks[key][marks[i]]) {
              videoMarks[key][marks[i]] = 1;
              track('video_progress', { progress: marks[i] });
            }
          }
        });
      }, { passive: true });
    });
  }

  function scanVideos() {
    safe(function () {
      var vids = document.querySelectorAll('video');
      for (var i = 0; i < vids.length; i++) attachVideo(vids[i]);
    });
  }

  // ── Live blog (sekcija 3.2) ───────────────────────────────────────────────
  function watchLiveBlog() {
    safe(function () {
      var root = document.querySelector('[data-pulse-liveblog]');
      if (!root || !window.MutationObserver) return;

      var seen = root.children.length;
      new MutationObserver(function () {
        var now = root.children.length;
        if (now > seen) {
          seen = now;
          track('live_blog_update', {});
        }
      }).observe(root, { childList: true });
    });
  }

  // ── A/B izloženost (sekcija 8.1, korak 4) ─────────────────────────────────
  var abSeen = {};

  function abExposure(testId, variant) {
    if (!testId || !variant) return;
    var key = testId + ':' + variant;
    if (abSeen[key]) return;
    abSeen[key] = 1;
    track('ab_exposure', { abTestId: testId, abVariant: variant });
  }

  function watchAbElements() {
    safe(function () {
      if (!window.IntersectionObserver) return;
      var nodes = document.querySelectorAll('[data-pulse-ab-test]');
      if (!nodes.length) return;

      var io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var el = entry.target;
          abExposure(el.getAttribute('data-pulse-ab-test'), el.getAttribute('data-pulse-ab-variant'));
          io.unobserve(el);
        }
      }, { threshold: 0.5 });

      for (var i = 0; i < nodes.length; i++) io.observe(nodes[i]);
    });
  }

  // ── Životni ciklus stranice ───────────────────────────────────────────────
  function sendTimeOnPage(useBeacon) {
    tickActive();
    if (activeMs < 1000) return;
    track('time_on_page', { activeMs: activeMs, depth: maxDepth });
    flush(useBeacon);
    activeMs = 0;
  }

  function pageview(metaOverride) {
    currentMeta = pageMeta(metaOverride);
    scrollSent = {};
    maxDepth = 0;
    activeMs = 0;
    lastTick = Date.now();
    track('pageview', {});
    checkScroll();
    scanVideos();
    watchAbElements();
    watchLiveBlog();
  }

  // ── Slušaoci ──────────────────────────────────────────────────────────────
  safe(function () {
    document.addEventListener('visibilitychange', function () {
      tickActive();
      visible = document.visibilityState === 'visible';
      lastTick = Date.now();
      if (!visible) sendTimeOnPage(true);
    });

    window.addEventListener('pagehide', function () { sendTimeOnPage(true); });
    window.addEventListener('beforeunload', function () { sendTimeOnPage(true); });

    var scrollTimer = null;
    window.addEventListener('scroll', function () {
      if (scrollTimer) return;
      scrollTimer = setTimeout(function () { scrollTimer = null; checkScroll(); }, 250);
    }, { passive: true });

    document.addEventListener('click', onClick, { passive: true, capture: true });

    setInterval(tickActive, 5000);
  });

  // ── Javni API ─────────────────────────────────────────────────────────────
  window.pulse = {
    __loaded: true,

    consent: function (granted) {
      consent = granted === true;
      store('l', LS_CONSENT, consent ? '1' : '0');
      if (!consent) {
        store('l', LS_VID, null);   // povlačenje consent-a briše ID
      } else {
        visitorId();
      }
      return consent;
    },

    hasConsent: function () { return consent; },
    page: pageview,
    track: track,
    abExposure: abExposure,
    flush: function () { flush(false); },
    sessionId: sessionId,

    /** Naslov iz A/B testa za listu članaka (sekcija 8.1, korak 2). */
    headline: function (articleId, cb) {
      safe(function () {
        var base = endpoint.replace(/\/collect$/, '');
        fetch(base + '/ab/headline?articleId=' + encodeURIComponent(articleId)
          + '&sessionId=' + encodeURIComponent(sessionId())
          + '&site=' + encodeURIComponent(site), { credentials: 'omit' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data && data.test) abExposure(data.test.testId, data.test.variant);
            cb(data && data.test ? data.test : null);
          })['catch'](function () { cb(null); });
      });
    }
  };

  // ── Start ─────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { pageview(); });
  } else {
    pageview();
  }
}(window, document));
