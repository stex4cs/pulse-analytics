# Pulse API

Dva odvojena servisa: **Ingestion** (javni, bez auth-a) i **Dashboard API** (JWT).

---

## Ingestion API

Bazni URL: `https://pulse.tvarenasport.com`

### `POST /collect`

Prima batch eventa. **Uvek vraća `204 No Content`**, i na grešci — klijent se nikad
ne blokira i nikad ne dobija stack trace.

`Content-Type`: `application/json` ili `text/plain` (`sendBeacon` šalje `text/plain`;
to izbegava CORS preflight).

```json
{
  "v": 1,
  "site": "rs",
  "sid": "s3f9a2c1e8b7d4a6f0c2e5b8",
  "vid": "v7d1e4b9a3c6f2085e1d7b4a",
  "new": 0,
  "consent": 1,
  "url": "https://tvarenasport.com/fudbal/superliga-srbije/76177",
  "ref": "https://news.google.com/",
  "vw": 390, "vh": 844, "wd": 0,
  "meta": {
    "articleId": "76177",
    "title": "Saša Ilić posle derbija",
    "author": "milan-nastic",
    "category": "fudbal/superliga-srbije",
    "tags": ["sasa-ilic", "fk-partizan"],
    "publishedAt": "2026-08-24T00:03:00Z",
    "contentType": "news",
    "wordCount": 420
  },
  "events": [
    { "type": "pageview",     "ts": 1787000000000 },
    { "type": "scroll_depth", "ts": 1787000012000, "depth": 50 },
    { "type": "time_on_page", "ts": 1787000090000, "activeMs": 84000 },
    { "type": "click",        "ts": 1787000030000, "selector": "a.related", "x": 180, "y": 2340 },
    { "type": "video_progress","ts": 1787000045000, "progress": 50 },
    { "type": "ab_exposure",  "ts": 1787000001000, "abTestId": "ab_9f3c1e", "abVariant": "B" }
  ]
}
```

Envelope polja (`sid`, `vid`, `consent`, `url`, `meta`, `vw`) važe za sve evente u
batch-u; pojedinačni event ih može pregaziti. Maksimum **50 eventa** po zahtevu;
višak se odbacuje i broji u `pulse_ingest_rejected_events_total`.

Rate limit: 100 zahteva/min po hash-u IP-a. Prekoračenje ne ruši merenje —
limiter je tolerantan na burst.

### `GET /ab/headline`

```
GET /ab/headline?articleId=76177&sessionId=s3f9…&site=rs
```

```json
{ "test": { "testId": "ab_9f3c1e", "variant": "B", "headline": "…", "final": false } }
```

`test: null` znači da za taj članak nema aktivnog testa. Dodela je deterministička po
`sessionId` — isti korisnik u istoj sesiji uvek dobija istu varijantu.

### `POST /ab/headlines`

Batch varijanta za naslovnu stranu — jedan poziv za celu listu:

```json
{ "articleIds": ["76177", "76180"], "sessionId": "s3f9…", "site": "rs" }
```

---

## Dashboard API

Bazni URL: `https://analitika.tvarenasport.com/api`

### Autentikacija

```
POST /auth/login      { "email": "...", "password": "..." }
POST /auth/refresh    { "refreshToken": "..." }
POST /auth/logout
GET  /auth/me
POST /auth/password   { "currentPassword": "...", "newPassword": "..." }
```

Access token važi 8h, refresh 30 dana i **rotira se pri svakoj upotrebi**.
Svi ostali pozivi traže `Authorization: Bearer <accessToken>`.

### Uloge

| Uloga | Pristup |
|---|---|
| `admin` | sve, uključujući korisnike, GDPR i sistemsko zdravlje |
| `editor` | svi izveštaji, A/B testovi, alerti |
| `author` | **isključivo sopstvena statistika** |

Autor koji zatraži tuđe podatke dobija `403`, bez obzira na to kojim putem —
pravilo je centralizovano u `packages/api/src/scope.js`.

### Zajednički parametri

| Parametar | Značenje |
|---|---|
| `site` | `rs` \| `hr` \| `ba` \| `si` (podrazumevano prvi dozvoljeni za korisnika) |
| `days` | 1–400, podrazumevano zavisi od rute |
| `from`, `to` | `YYYY-MM-DD`, imaju prednost nad `days` |
| `sort`, `dir` | sortiranje po beloj listi kolona; `asc` \| `desc` |
| `limit` | broj redova |

Sva vremena u odgovorima su **UTC**.

### Rute

| Metoda | Ruta | Uloga | Šta vraća |
|---|---|---|---|
| GET | `/overview` | sve | ukupno, kanali, satni grafik, top tekstovi, aktivan spike |
| GET | `/realtime` | sve | aktivni posetioci (5 min), puls po minutu, top tekstovi uživo |
| GET | `/authors` | sve | leaderboard sa trendom |
| GET | `/authors/:slug` | sve | detalj: serija, top tekstovi, kanali, kategorije |
| GET | `/authors/export.csv` | sve | CSV |
| GET | `/authors/periods` | admin, editor | nedeljni / mesečni rollup |
| GET | `/categories` | admin, editor | nivo 1; `?root=fudbal` spušta nivo niže |
| GET | `/categories/compare` | admin, editor | `?categories=a,b,c` — do 6 serija |
| GET | `/categories/channels` | admin, editor | matrica kanal × kategorija |
| GET | `/tags/trending` | admin, editor | trending tagovi (24h) |
| GET | `/tags` | admin, editor | svi tagovi za period |
| GET | `/tags/:tag` | admin, editor | serija + tekstovi sa tagom |
| GET | `/articles` | sve | lista; filteri `q`, `category`, `contentType` |
| GET | `/articles/:id` | sve | detalj: serija, kanali, levak, percentil, A/B |
| GET | `/articles/:id/heatmap` | admin, editor | ćelije heatmape; `?viewport=375` |
| GET | `/articles/export.csv` | sve | CSV |
| GET | `/sources` | admin, editor | kanali sa bounce i sesijama |
| GET | `/sources/timeseries` | admin, editor | kretanje po kanalu |
| GET | `/sources/discover` | admin, editor | Discover izdvojeno + poređenje |
| GET | `/sources/devices` | admin, editor | matrica kanal × uređaj |
| GET | `/sources/campaigns` | admin, editor | UTM kampanje |
| GET | `/sources/export.csv` | admin, editor | CSV |
| GET | `/ab/tests` | admin, editor | testovi sa značajnošću |
| POST | `/ab/tests` | admin, editor | novi test (2–3 varijante) |
| POST | `/ab/tests/:id/stop` | admin, editor | zaustavi ili promoviši pobednika |
| DELETE | `/ab/tests/:id` | admin | brisanje |
| GET | `/geo` | sve | države; filteri `source`, `category`, `tag`, `author` |
| GET | `/geo/cities` | sve | gradovi sa koordinatama; filter `country` |
| GET | `/geo/channels` | admin, editor | matrica država × kanal |
| GET | `/geo/export.csv` | sve | CSV |
| GET | `/channels` | sve | matrica entitet × kanal; `dimension=author\|category\|tag`, opciono `entity` |
| GET | `/channels/export.csv` | admin, editor | CSV |
| GET | `/alerts` | admin, editor | spike alerti |
| POST | `/alerts/:id/resolve` | admin, editor | označi kao rešeno |
| GET | `/users` | admin | lista korisnika |
| POST | `/users` | admin | novi korisnik |
| PATCH | `/users/:id` | admin | izmena (menja ulogu → poništava sesije) |
| DELETE | `/gdpr/visitor/:id` | admin | brisanje svih eventa posetioca |
| GET | `/gdpr/visitor/:id` | admin | šta sistem zna o posetiocu |
| GET | `/gdpr/deletions` | admin | revizioni trag |
| GET | `/system/health` | admin | stanje cron poslova + ClickHouse 24h |

### Greške

```json
{ "error": "Autor može da vidi samo sopstvenu statistiku" }
```

| Kod | Kada |
|---|---|
| 400 | neispravan parametar |
| 401 | nema/istekao token |
| 403 | uloga nema pristup traženom resursu |
| 404 | resurs ne postoji |
| 409 | konflikt (npr. već postoji aktivan A/B test za članak) |
| 429 | rate limit |
| 500 | interna greška — detalji samo u logu, nikad u odgovoru |

---

## Metrike

`GET /metrics` na svakom servisu (blokirano na nginx-u za spoljni svet):

`pulse_ingest_requests_total` · `pulse_ingest_errors_total` ·
`pulse_ingest_duration_seconds` · `pulse_ingest_rejected_events_total` ·
`pulse_ingest_spool_writes_total` · `pulse_queue_depth` ·
`pulse_worker_batch_duration_seconds` · `pulse_clickhouse_insert_errors_total` ·
`pulse_cron_last_success_timestamp` · `pulse_spike_alerts_total` ·
`pulse_api_requests_total`
