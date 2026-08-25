/**
 * Bot filtering na ingestion-u (sekcija 3.3).
 *
 * Tri sloja:
 *   1) UA blacklist + headless detekcija  -> @pulse/shared/ua
 *   2) navigator.webdriver koji SDK javlja
 *   3) stopa: >10 pageview/s sa istog IP hash-a
 *
 * Botovi se NE odbacuju - upisuju se sa is_bot=1 i filtriraju iz izvestaja.
 */
import { BOT_REASONS } from '@pulse/shared';

/**
 * Brojac po sekundi u Redis-u. Kljuc zivi 2s, pa je memorijski trag zanemarljiv.
 * Ako Redis ne odgovori, ne blokiramo ingestion - vracamo "nije bot".
 *
 * @returns {Promise<boolean>} da li je stopa prekoracena
 */
export async function isRateAbuse(redis, ipHash, pageviewCount, limitPerSecond) {
  if (!ipHash || pageviewCount <= 0) return false;
  try {
    const key = `pulse:rate:${ipHash}:${Math.floor(Date.now() / 1000)}`;
    const [[, count]] = await redis
      .pipeline()
      .incrby(key, pageviewCount)
      .expire(key, 2)
      .exec();
    return Number(count) > limitPerSecond;
  } catch {
    return false;
  }
}

/**
 * Objedinjuje sve signale u jednu odluku.
 *
 * @param {object} args
 * @param {{is_bot: boolean, bot_reason: string}} args.uaResult
 * @param {boolean} args.webdriver   navigator.webdriver iz SDK-a
 * @param {boolean} args.rateAbuse
 * @param {boolean} args.hasSession
 */
export function decideBot({ uaResult, webdriver, rateAbuse, hasSession }) {
  if (uaResult.is_bot) return { isBot: true, reason: uaResult.bot_reason };
  if (webdriver) return { isBot: true, reason: BOT_REASONS.HEADLESS };
  if (!hasSession) return { isBot: true, reason: BOT_REASONS.NO_SESSION };
  if (rateAbuse) return { isBot: true, reason: BOT_REASONS.RATE };
  return { isBot: false, reason: '' };
}
