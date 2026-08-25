import { config, pgQuery, pgQueryOne } from '@pulse/shared';
import {
  hashPassword, verifyPassword, issueRefreshToken, consumeRefreshToken,
  revokeAllTokens, publicUser, ROLES,
} from '../auth.js';

export default async function authRoutes(app) {
  // ── Prijava ──────────────────────────────────────────────────────────────
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email i lozinka su obavezni' });
    }

    const user = await pgQueryOne(
      'SELECT * FROM users WHERE lower(email) = lower($1) AND is_active',
      [String(email)],
    );

    // Ista poruka i isto vreme odgovora bez obzira na to sta je pogresno
    const ok = user ? await verifyPassword(user.password_hash, String(password)) : false;
    if (!ok) {
      return reply.code(401).send({ error: 'Pogrešan email ili lozinka' });
    }

    await pgQuery('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const payload = publicUser(user);
    const accessToken = app.jwt.sign(payload, { expiresIn: config.api.accessTtl });
    const refresh = await issueRefreshToken(user.id);

    return { accessToken, refreshToken: refresh.token, expiresAt: refresh.expiresAt, user: payload };
  });

  // ── Osvezavanje tokena (rotacija) ────────────────────────────────────────
  app.post('/auth/refresh', async (req, reply) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) return reply.code(400).send({ error: 'refreshToken je obavezan' });

    const row = await consumeRefreshToken(String(refreshToken));
    if (!row) return reply.code(401).send({ error: 'Refresh token nije važeći' });

    const payload = publicUser({ ...row, id: row.user_id });
    const accessToken = app.jwt.sign(payload, { expiresIn: config.api.accessTtl });
    const next = await issueRefreshToken(row.user_id);

    return { accessToken, refreshToken: next.token, expiresAt: next.expiresAt, user: payload };
  });

  app.post('/auth/logout', { preHandler: [app.authenticate] }, async (req) => {
    await revokeAllTokens(req.user.id);
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: [app.authenticate] }, async (req) => ({ user: req.user }));

  // ── Upravljanje korisnicima (samo admin) ─────────────────────────────────
  app.get('/users', { preHandler: [app.requireRole(ROLES.ADMIN)] }, async () => {
    const users = await pgQuery(
      `SELECT id, email, name, role, author_slug, sites, is_active, last_login_at, created_at
         FROM users ORDER BY created_at DESC`,
    );
    return { users };
  });

  app.post('/users', { preHandler: [app.requireRole(ROLES.ADMIN)] }, async (req, reply) => {
    const { email, password, name, role, authorSlug, sites } = req.body ?? {};

    if (!email || !password) return reply.code(400).send({ error: 'Email i lozinka su obavezni' });
    if (String(password).length < 12) {
      return reply.code(400).send({ error: 'Lozinka mora imati bar 12 karaktera' });
    }
    if (!Object.values(ROLES).includes(role)) {
      return reply.code(400).send({ error: `Uloga mora biti jedna od: ${Object.values(ROLES).join(', ')}` });
    }
    if (role === ROLES.AUTHOR && !authorSlug) {
      return reply.code(400).send({ error: 'Za ulogu "author" je obavezan authorSlug' });
    }

    try {
      const user = await pgQueryOne(
        `INSERT INTO users (email, name, password_hash, role, author_slug, sites)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, name, role, author_slug, sites, created_at`,
        [String(email).toLowerCase(), name ?? null, await hashPassword(String(password)),
          role, authorSlug ?? null, sites?.length ? sites : ['rs']],
      );
      return reply.code(201).send({ user });
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ error: 'Korisnik sa tim email-om već postoji' });
      throw err;
    }
  });

  app.patch('/users/:id', { preHandler: [app.requireRole(ROLES.ADMIN)] }, async (req, reply) => {
    const { name, role, authorSlug, sites, isActive, password } = req.body ?? {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Neispravan id' });

    const sets = [];
    const params = [id];
    const push = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };

    if (name !== undefined) push('name', name);
    if (role !== undefined) {
      if (!Object.values(ROLES).includes(role)) return reply.code(400).send({ error: 'Neispravna uloga' });
      push('role', role);
    }
    if (authorSlug !== undefined) push('author_slug', authorSlug);
    if (sites !== undefined) push('sites', sites);
    if (isActive !== undefined) push('is_active', Boolean(isActive));
    if (password !== undefined) {
      if (String(password).length < 12) return reply.code(400).send({ error: 'Lozinka mora imati bar 12 karaktera' });
      push('password_hash', await hashPassword(String(password)));
    }

    if (!sets.length) return reply.code(400).send({ error: 'Nema šta da se izmeni' });

    const user = await pgQueryOne(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1
       RETURNING id, email, name, role, author_slug, sites, is_active`,
      params,
    );
    if (!user) return reply.code(404).send({ error: 'Korisnik ne postoji' });

    // Izmena uloge ili deaktivacija mora odmah da povuce postojece sesije
    if (role !== undefined || isActive === false || password !== undefined) {
      await revokeAllTokens(id);
    }
    return { user };
  });

  // Promena sopstvene lozinke
  app.post('/auth/password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return reply.code(400).send({ error: 'Obavezna su oba polja' });
    }
    if (String(newPassword).length < 12) {
      return reply.code(400).send({ error: 'Nova lozinka mora imati bar 12 karaktera' });
    }

    const user = await pgQueryOne('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!user || !(await verifyPassword(user.password_hash, String(currentPassword)))) {
      return reply.code(401).send({ error: 'Trenutna lozinka nije tačna' });
    }

    await pgQuery('UPDATE users SET password_hash = $2 WHERE id = $1',
      [user.id, await hashPassword(String(newPassword))]);
    await revokeAllTokens(user.id);
    return { ok: true };
  });
}
