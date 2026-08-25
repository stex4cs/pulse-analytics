/**
 * Auth i uloge (sekcija 11).
 *
 *   admin  - sve, ukljucujuci korisnike i podesavanja
 *   editor - svi izvestaji, A/B testovi, alerti
 *   author - iskljucivo sopstvena statistika
 *
 * JWT access token 8h, refresh token 30 dana (cuva se samo hash).
 * Lozinke: argon2id.
 */
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { config, pgQuery, pgQueryOne } from '@pulse/shared';

// Pravila vidljivosti zive u scope.js (ciste funkcije) i reeksportuju se ovde
// da rute imaju jedno mesto za sve sto se tice pristupa.
export { ROLES, authorScope, siteScope } from './scope.js';

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MiB - OWASP preporuka
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain) => argon2.hash(plain, ARGON_OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function ttlToMs(ttl) {
  const m = String(ttl).match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 86400_000;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]];
  return Number(m[1]) * mult;
}

export async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlToMs(config.api.refreshTtl));
  await pgQuery(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hashToken(token), expiresAt],
  );
  return { token, expiresAt };
}

export async function consumeRefreshToken(token) {
  const row = await pgQueryOne(
    `SELECT rt.id, rt.user_id, u.email, u.role, u.author_slug, u.sites, u.name
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
      WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now() AND u.is_active`,
    [hashToken(token)],
  );
  if (!row) return null;
  // Rotacija: stari token se odmah povlaci
  await pgQuery('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
  return row;
}

export async function revokeAllTokens(userId) {
  await pgQuery('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
}

/** Ociscen korisnik za JWT payload i /me. */
export const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  authorSlug: u.author_slug ?? null,
  sites: u.sites ?? ['rs'],
});

// ── Fastify hook-ovi ───────────────────────────────────────────────────────
export function registerAuthHooks(app) {
  app.decorate('authenticate', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Neautorizovano' });
    }
  });

  /** requireRole('admin') / requireRole('admin', 'editor') */
  app.decorate('requireRole', (...roles) => async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Neautorizovano' });
    }
    if (!roles.includes(req.user.role)) {
      return reply.code(403).send({ error: 'Nemate pristup ovom resursu' });
    }
  });
}
