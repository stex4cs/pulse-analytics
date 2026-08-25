/**
 * Pravila vidljivosti (sekcija 11) - ciste funkcije, bez I/O.
 *
 * Izdvojeno iz auth.js namerno: ovo je bezbednosno pravilo koje mora da bude
 * testirljivo samo za sebe, bez baze, argon2 i JWT-a.
 */

export const ROLES = Object.freeze({ ADMIN: 'admin', EDITOR: 'editor', AUTHOR: 'author' });

/**
 * Autor vidi iskljucivo sopstvenu statistiku.
 *
 * @returns {{author: string|null}} filter koji ruta mora primeniti
 * @throws  {Error & {statusCode: 403}} ako autor trazi tudje podatke
 */
export function authorScope(user, requestedAuthor) {
  if (user.role !== ROLES.AUTHOR) {
    return { author: requestedAuthor || null };
  }
  if (requestedAuthor && requestedAuthor !== user.authorSlug) {
    const err = new Error('Autor može da vidi samo sopstvenu statistiku');
    err.statusCode = 403;
    throw err;
  }
  return { author: user.authorSlug };
}

/** Sajt na koji korisnik sme - sprecava citanje tudjeg domena. */
export function siteScope(user, requestedSite) {
  const allowed = user.sites?.length ? user.sites : ['rs'];
  const site = requestedSite || allowed[0];
  if (!allowed.includes(site)) {
    const err = new Error(`Nemate pristup sajtu "${site}"`);
    err.statusCode = 403;
    throw err;
  }
  return site;
}
