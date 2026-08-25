# Bezbednost

## Prijava ranjivosti

Pišite na stex4cs@gmail.com. Ne otvarajte javni issue za bezbednosne propuste.

---

## Šta ovaj repozitorijum sadrži, a šta ne

Repo je **javan** i sadrži isključivo izvorni kod. U njemu nema:

- lozinki, tokena ni API ključeva — `.env.example` ima samo `change_me_*` placeholder vrednosti
- podataka o stvarnom saobraćaju
- GeoLite2 baze (nabavlja se zasebno, `geoip/`)
- TLS sertifikata (`nginx/certs/` je prazan i ignorisan)

Sve tajne se postavljaju kroz `.env` na serveru, koji je u `.gitignore`.

`assertProductionSecrets()` u `packages/shared/src/config.js` **odbija da pokrene servis**
u produkciji ako su `JWT_SECRET` ili `IP_HASH_SECRET` prazni, prekratki ili ostavljeni na
razvojnoj vrednosti. Slabu tajnu je lakše ne primetiti nego servis koji neće da startuje.

---

## Podaci o posetiocima

| Podatak | Kako se tretira |
|---|---|
| **IP adresa** | **Nikad se ne čuva.** Iz nje izlaze samo geo rezultat (država, grad) i dnevno-salted hash |
| `ip_hash` | HMAC-SHA256 sa saltom koji se menja svakog dana u ponoć UTC — posetilac se ne može pratiti između dana ni iz same baze |
| `lat` / `lon` | Koordinate **centra grada** iz MaxMind-a, zaokružene na 2 decimale (~1 km). Nose istu informaciju kao ime grada — nisu lokacija korisnika |
| `visitor_id` | Samo uz consent. Bez consent-a kolona ostaje prazna |
| Koordinate klikova | Samo uz consent — bez njega nema heatmape |
| Sirovi eventi | TTL 90 dana; klik eventi 30 dana |
| Agregati | Trajni, ali anonimni — ne sadrže `visitor_id` |

Rate limiter radi **po hash-u IP-a**, ne po sirovom IP-u, pa se ni u memoriji ne drži adresa.

---

## Pristup dashboard-u

- **argon2id** za lozinke (19 MiB, timeCost 2 — OWASP preporuka)
- Access token 8h, refresh token 30 dana; refresh se **rotira** pri svakoj upotrebi i čuva se samo hash
- Promena uloge, deaktivacija naloga ili promena lozinke **odmah poništavaju sve sesije**
- Minimalna dužina lozinke 12 karaktera
- Odgovor na neuspelu prijavu je isti bez obzira na to da li nalog postoji

Uloge (`packages/api/src/scope.js`, čiste funkcije sa zasebnim testovima):

| Uloga | Pristup |
|---|---|
| `admin` | sve, uključujući korisnike, GDPR i sistemsko zdravlje |
| `editor` | izveštaji, A/B testovi, alerti |
| `author` | **isključivo sopstvena statistika** |

Autor koji zatraži tuđe podatke dobija `403` bez obzira kojom rutom — pravilo je na jednom
mestu, ne raspoređeno po rutama.

---

## Površina izloženosti

Javno je dostupno samo ono što mora:

| Servis | Izložen | Napomena |
|---|---|---|
| `/collect`, `/ab/*`, `/pulse.js` | da | mora — poziva ih sajt |
| Dashboard + API | da, na zasebnom hostu | JWT na svakoj ruti |
| `/metrics` | **ne** | `deny all` u nginx-u |
| ClickHouse, Redis, Postgres | **ne** | samo unutar Docker mreže, bez objavljenih portova |
| Worker, cron | **ne** | nemaju HTTP osim `/metrics` na internom portu |

Sigurnosna zaglavlja: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy`, HSTS — podešena i u nginx-u i u Next.js konfiguraciji.

---

## Otpornost ingestion-a

- `/collect` **uvek** vraća 204, i na grešci — pokvareno telo ne ruši servis i ne vraća stack trace
- Rate limit 100 req/min po hash-u IP-a, spike-tolerantan
- Bot filtering u tri sloja: UA blacklist, `navigator.webdriver`, stopa >10 pageview/s
- Botovi se **ne odbacuju** nego označavaju sa `is_bot=1` i filtriraju iz izveštaja
- Ako Redis padne, eventi idu u lokalni append-only fajl; worker ih preuzme po oporavku

Greške se logiraju bez tela zahteva; pino redakcija uklanja `authorization`, `cookie`,
`password` i `password_hash` iz logova.

---

## SQL i injekcija

- Postgres: isključivo parametrizovani upiti
- ClickHouse: `query_params` (`{name:Type}`), nikad interpolacija
- Sortiranje: bela lista kolona (`orderBy` u `packages/api/src/utils.js`) — korisnički string
  nikad ne ulazi u SQL; postoji test koji to proverava
- Datumi iz query stringa se validiraju regexom pre upotrebe

---

## Demo deployment

`NEXT_PUBLIC_PULSE_DEMO=1` gradi dashboard koji **ne dodiruje nijedan backend** — svi odgovori
se generišu u pregledaču (`packages/dashboard/lib/demo.js`). U tom režimu CSP je
`connect-src 'self'`, pa pregledač blokira svaki odlazni poziv čak i ako bi ga kod pokušao.

Demo podaci su izmišljeni i svaki ekran nosi vidljivu oznaku. Ne predstavljaju stvarni
saobraćaj tvarenasport.com-a.

---

## Mapa

Granice država i unutrašnje granice (savezne države, pokrajine) su **ugrađene u kod**
kao SVG putanje (`packages/dashboard/lib/world-map.js` i `world-subdivisions.js`),
generisane iz Natural Earth podataka (public domain). Dashboard ne poziva nijedan servis
za pločice mape — CSP `default-src 'self'` to i ne bi dozvolio, a i ne želimo da posetioci
dashboarda i njihova IP adresa odlaze trećoj strani samo da bi se videla mapa.

---

## Šta NE raditi

- **Ne stavljati ingest, worker ni cron na serverless.** Spool fallback zavisi od trajnog
  fajl sistema, worker od dugotrajnog procesa na `XREADGROUP ... BLOCK`. Na serverless
  platformi garancija „nikad ne gubi evente" prestaje da važi.
- **Ne objavljivati `/metrics`.** Otkriva obim saobraćaja i unutrašnje stanje.
- **Ne otvarati portove baza.** ClickHouse i Postgres nemaju `ports:` u `docker-compose.yml`
  s razlogom.
- **Ne isključivati consent proveru** da bi se „popravila" heatmapa.
