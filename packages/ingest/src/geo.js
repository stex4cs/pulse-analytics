/**
 * Geo lookup (sekcija 4.2, tacka 2).
 *
 * VAZNO: IP se nikad ne cuva. Iz IP-a izlaze samo (a) drzava/grad i
 * (b) dnevno-salted hash za bot detekciju (sekcija 12.2).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from '@pulse/shared';

let reader = null;
let readerLoaded = false;

export async function initGeo(log) {
  if (readerLoaded) return;
  readerLoaded = true;
  const path = config.ingest.geoipDb;
  if (!path || !fs.existsSync(path)) {
    log?.warn?.(`GeoLite2 baza nije nadjena na "${path}" - geo se svodi na CDN zaglavlja`);
    return;
  }
  try {
    const maxmind = await import('maxmind');
    reader = await maxmind.open(path);
    log?.info?.('GeoLite2-City ucitan');
  } catch (err) {
    log?.error?.({ err: err.message }, 'GeoLite2 nije ucitan');
  }
}

const EMPTY = { country: '', city: '', lat: 0, lon: 0 };

/** Koordinate centra grada, ~1km tacnost. Nose isto sto i ime grada. */
const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);

/**
 * @param {string} ip
 * @param {object} headers  za CDN fallback (Cloudflare / nginx geo modul)
 */
export function lookupGeo(ip, headers = {}) {
  const headerCountry = (headers['cf-ipcountry'] || headers['x-geo-country'] || '').toString().toUpperCase();

  if (reader && ip) {
    try {
      const res = reader.get(ip);
      if (res) {
        return {
          country: res.country?.iso_code ?? res.registered_country?.iso_code ?? headerCountry ?? '',
          city: res.city?.names?.en ?? '',
          lat: round2(res.location?.latitude),
          lon: round2(res.location?.longitude),
        };
      }
    } catch {
      /* pad na fallback */
    }
  }

  if (headerCountry && headerCountry !== 'XX') {
    return {
      country: headerCountry,
      city: (headers['x-geo-city'] || '').toString().slice(0, 120),
      lat: round2(Number(headers['x-geo-lat'])),
      lon: round2(Number(headers['x-geo-lon'])),
    };
  }
  return EMPTY;
}

/**
 * Dnevno-salted hash IP-a. Salt se menja svakog dana u ponoc UTC, pa se
 * posetioci ne mogu pratiti izmedju dana ni iz same baze.
 */
let saltDay = '';
let saltValue = '';

export function hashIp(ip) {
  if (!ip) return '';
  const day = new Date().toISOString().slice(0, 10);
  if (day !== saltDay) {
    saltDay = day;
    saltValue = crypto.createHmac('sha256', config.ingest.ipHashSecret).update(day).digest('hex');
  }
  return crypto.createHash('sha256').update(saltValue).update(ip).digest('hex').slice(0, 32);
}

/** Pravi klijentski IP iza nginx-a / CDN-a. */
export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const real = req.headers['x-real-ip'];
  if (real) return String(real).trim();
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.ip ?? '';
}
