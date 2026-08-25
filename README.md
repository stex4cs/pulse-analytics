# Pulse

Custom analytics platforma za **tvarenasport.com** (TV Arena Sport / Arena Channels Group).

Radi ono što GA4 ne radi dobro za news portal: analitiku po **autoru, kategoriji i tagu**,
precizan **traffic source attribution** (sa Google Discover-om izdvojenim), **real-time**
praćenje spike-ova tokom utakmica i **A/B testiranje naslova** sa poštenim pragom značajnosti.

Prvi-party: podaci ne izlaze iz infrastrukture klijenta.

---

## Sadržaj

- [Arhitektura](#arhitektura)
- [Brzi start](#brzi-start)
- [Struktura repozitorijuma](#struktura-repozitorijuma)
- [Komande](#komande)
- [Šta je gde implementirano](#šta-je-gde-implementirano)
- [Šta je verifikovano](#šta-je-verifikovano)
- [Namerna odstupanja od specifikacije](#namerna-odstupanja-od-specifikacije)
- [Deployment: šta ide gde](#deployment-šta-ide-gde)
- [Dokumentacija](#dokumentacija)

---

## Arhitektura

```
Browser (pulse.js, <5KB gz)
   │  POST /collect  — batch, sendBeacon
   ▼
Ingestion API (Fastify ×2)   validacija · geo · bot filter · attribution
   │  XADD
   ▼
Redis Streams                buffer koji apsorbuje spike
   │  XREADGROUP (1000 / 5s)
   ▼
Worker                       batch INSERT (XACK tek posle uspeha)
   ▼
ClickHouse                   sirovi eventi (90d TTL) + 21 materialized view
   │  cron: 5 min / noćno
   ▼
PostgreSQL                   dashboard-ready agregati
   ▼
Dashboard API (JWT, uloge)  →  Next.js dashboard
```

Ako Redis padne, ingest piše u lokalni append-only fajl i worker ga kasnije pokupi —
**event se ne gubi**.

---

## Brzi start (lokalno)

Potreban je samo Docker. Testirano na Docker 29 / Windows + WSL2.

### 1. Tajne

```bash
cp .env.example .env
```

Zameniti četiri `change_me` vrednosti u `.env`:
`CLICKHOUSE_PASSWORD`, `POSTGRES_PASSWORD`, `IP_HASH_SECRET`, `JWT_SECRET`.

```bash
# Generisanje jedne tajne
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Servisi **odbijaju da se pokrenu** ako su tajne ostale na razvojnoj vrednosti —
to je namerno.

### 2. Podizanje

```bash
docker compose up -d --build
```

Prvi put traje nekoliko minuta (gradi 6 slika). ClickHouse i Postgres sami
izvršavaju migracije iz `db/`. Provera:

```bash
docker compose ps
```

Svih 12 servisa treba da bude `Up`; `clickhouse`, `postgres`, `redis`, `api`,
`ingest-1`, `ingest-2` i `dashboard` još i `(healthy)`.

### 3. Admin nalog

```bash
docker compose exec api node scripts/seed.mjs   --admin=urednik@tvarenasport.com --password='IzaberiteJakuLozinku123!'
```

### 4. Provera da lanac radi

```bash
docker compose exec api node scripts/smoke-test.mjs --endpoint=http://nginx
```

Pošalje tri eventa i prati ih kroz Redis → worker → ClickHouse → materialized views,
uz proveru attribution-a, UA parsinga i consent-a.

### 5. Otvaranje

Iza nginx-a servisi se razlikuju po `Host` zaglavlju, što lokalno smeta. Zato:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose up -d
```

Compose sam učitava override i objavljuje portove na `127.0.0.1`:

| Adresa | Šta |
|---|---|
| http://localhost:3000 | **Dashboard** |
| http://localhost:8081 | Dashboard API |
| http://localhost:8090 | Ingestion (`/collect`) |
| http://localhost:3001 | Grafana (admin / `GRAFANA_PASSWORD`) |
| localhost:18123 | ClickHouse HTTP |
| localhost:15432 | Postgres |
| localhost:16379 | Redis |

Portovi baza su pomereni (18123 / 15432 / 16379) da se ne sudare sa drugim
lokalnim projektima, a ingest je na 8090 jer 8080 obično drži XAMPP.

Prijavite se podacima iz koraka 3.

Provera kroz nginx, onako kako radi u produkciji:

```bash
curl -H "Host: analitika.tvarenasport.com" http://localhost/login
curl -H "Host: pulse.tvarenasport.com"     http://localhost/health
```

> `docker-compose.override.yml` je u `.gitignore` i **ne sme da postoji na
> produkciji** — tamo se bazama prilazi samo iz Docker mreže.

### 6. Podaci za probu

Bez saobraćaja je dashboard prazan. Sintetički podaci:

```bash
docker compose exec api  node scripts/seed.mjs --demo=5
docker compose exec cron node packages/cron/src/cli.js articles 30
docker compose exec cron node packages/cron/src/cli.js daily 2026-08-20 2026-08-25
docker compose exec cron node packages/cron/src/cli.js hourly 200
docker compose exec cron node packages/cron/src/cli.js trending
```

Cron sve ovo radi sam svakih 5 minuta — ovo je samo da ne čekate.

### Gašenje

```bash
docker compose down          # zaustavi, podaci ostaju
docker compose down -v       # obriši i podatke
```

---

## Razvoj bez Dockera

Baze u Dockeru, servisi lokalno uz `--watch`:

```bash
npm install
docker compose up -d clickhouse postgres redis
npm run migrate

npm run dev:ingest      # :8080
npm run dev:worker
npm run dev:api         # :8081
npm run dev:dashboard   # :3000
```

Za to `.env` mora imati `CLICKHOUSE_URL=http://localhost:8123`,
`POSTGRES_HOST=localhost` i `REDIS_URL=redis://localhost:6379`, a compose
mora izlagati te portove.

---

## Struktura repozitorijuma

```
db/clickhouse/       šema + 21 materialized view
db/postgres/         agregati, auth, A/B, alerti, job tracking
packages/shared/     attribution, validacija, UA/bot, statistika, klijenti, metrike
packages/ingest/     POST /collect, GET /ab/headline, geo, bot filter, spool
packages/worker/     Redis Streams → ClickHouse, XAUTOCLAIM, replay spool-a
packages/cron/       agregacije, trending, spike detekcija, A/B evaluacija, izveštaji
packages/api/        dashboard REST API (JWT, uloge, CSV export, GDPR)
packages/dashboard/  Next.js 14 App Router + Tailwind + Recharts
sdk/                 pulse.js (2.8 KB gzipped) + build sa proverom budžeta
monitoring/          Prometheus alerti + Grafana dashboard
loadtest/            k6 scenario sa burst-om od 2000 req/s
scripts/             migrate, seed, smoke-test
docs/                integracija za Arena tim, operativni priručnik, čitanje izveštaja
```

---

## Komande

| Komanda | Šta radi |
|---|---|
| `npm test` | unit testovi (attribution, statistika, uloge) — 90 testova |
| `npm run migrate` | ClickHouse + Postgres migracije (idempotentne) |
| `npm run seed` | admin nalog (+ `--demo=N` za sintetičke podatke) |
| `npm run smoke` | end-to-end provera lanca |
| `npm run build:sdk` | build `pulse.js`, **pada ako pređe 5 KB gzipped** |
| `npm run loadtest` | k6 test sa derbi spike profilom |
| `npm run -w @pulse/cron run-once -- <posao>` | ručno pokretanje agregacije / backfill |

Skaliranje worker-a kad red poraste:

```bash
docker compose up -d --scale worker=3
```

---

## Šta je gde implementirano

| Zahtev iz spec-a | Gde |
|---|---|
| Traffic source attribution (5.1) | `packages/shared/src/traffic-source.js` + 40 unit testova |
| Google Discover kao poseban kanal (5.3) | isti fajl; poseban ekran u `/kanali` |
| Bot filtering (3.3) | `packages/shared/src/ua.js`, `packages/ingest/src/bot.js` |
| Redis fallback (4.3) | `packages/ingest/src/spool.js`, `packages/worker/src/spool-reader.js` |
| Materialized views (6.2) | `db/clickhouse/002_materialized_views.sql` |
| Read completion (9.2) | `mv_timeonpage_daily` + `stats.js:isRealRead` |
| Trending score (9.3) | `stats.js:trendingScore`, `cron/jobs/trending.js` |
| Spike detekcija (9.4) | `cron/jobs/spike.js` — baseline po danu u nedelji i satu |
| A/B značajnost (8.2) | `stats.js:evaluateAbTest` — prag 95% **i** 1000 impresija |
| Heatmape (9.1) | `mv_heatmap_clicks` + `components/heatmap.jsx` (canvas) |
| Uloge (11) | `packages/api/src/scope.js` — autor vidi samo sebe |
| GDPR (12) | `packages/api/src/routes/gdpr.js`, consent u SDK-u |
| Monitoring (13.4) | `monitoring/alerts.yml` — svi traženi alerti |
| Geografija (dodato) | `mv_geo_daily`, `routes/geo.js`, ekran `/geografija` sa ugrađenom mapom |
| Kanal po autoru/kategoriji/tagu (dodato) | `*_source_daily` MV-ovi, `routes/channels.js`, ekran `/odakle-klikovi` |

---

## Šta je verifikovano

Ceo lanac je pokrenut protiv stvarnih ClickHouse, Postgres i Redis instanci, ne samo napisan:

| Provera | Rezultat |
|---|---|
| ClickHouse šema | 20 tabela + 18 materialized views se kreiraju bez greške |
| Materialized views | event upisan → svi MV-ovi popunjeni tačno (uključujući `ARRAY JOIN` po tagovima, `uniqMerge`, izvedeni `category_root`) |
| Read completion formula | 420 reči → prag 126s; sa 150s aktivnog vremena i 75% skrola broji se kao pročitano |
| Postgres šema | 18 tabela; `CHECK` ograničenja odbijaju autora bez slug-a i nepoznatu ulogu |
| Agregacije CH → PG | 13.114 pregleda u ClickHouse-u = 13.114 u Postgres-u; po autoru se poklapa red po red |
| Jedinstveni posetioci | `uniqMerge` daje 4.585, kontrola nad sirovim eventima 4.584 (HyperLogLog odstupanje 0,02%) |
| Smoke test | pun lanac: `/collect` → Redis → worker → ClickHouse → MV, sa proverom attribution-a i UA parsinga |
| Redis pada | klijent i dalje dobija 204, eventi idu u spool fajl, worker ih sam preuzme po oporavku — **nijedan event nije izgubljen** |
| Bot filtering | Googlebot i HeadlessChrome upisani sa `is_bot=1` i tačnim razlogom; pokvareno telo ne ruši servis |
| Uloge | autor vidi samo sebe (tuđa statistika → 403), editorske i admin rute → 403, bez tokena → 401 |
| A/B prag (8.2) | pri 400 prikaza i **99,9% konfidencije** pobednik se NE proglašava; na 1100 prikaza se proglašava |
| A/B dodela | deterministička po sesiji; keš se osvežava periodično, sa timeout-om |
| Heatmapa | ispod 500 pregleda odbija prikaz uz objašnjenje |
| GDPR brisanje | 9 eventa obrisano iz ClickHouse-a, revizioni trag `completed` |
| Dashboard | Next.js build prolazi, svih 12 ruta |
| SDK | 2,80 KB gzipped (budžet 5 KB) |
| Testovi | 90 unit testova prolazi |
| **Ceo Docker Compose stack** | svih 12 servisa `Up`, 7 sa healthcheck-om `healthy` |
| Smoke test kroz nginx | ceo lanac radi u produkcijskoj postavci, ne samo pojedinačno |

Greške pronađene i ispravljene tokom ove verifikacije, koje se ne bi videle bez pokretanja:

1. **`minute_pulse` bi tiho gubio brojeve** — `AggregatingMergeTree` sa običnom `UInt64` kolonom
   pri merge-u zadržava proizvoljnu vrednost umesto zbira. Pogodilo bi real-time widget i spike detekciju.
2. **ClickHouse razrešava SELECT alias i u `WHERE`** — `toString(date) AS date` je pregazio pravu
   `Date` kolonu, pa je filter po datumu poredio String sa Date i rušio sve dnevne agregacije.
3. **`GROUP BY t.test_id` nije dovoljan** — Postgres priznaje funkcionalnu zavisnost samo za
   primarni ključ; `test_id` je `UNIQUE`, pa su tri upita (A/B lista, detalj članka, cron posao) padala.
4. **`argMinState` nad `LowCardinality(String)`** pravi state koji se ne poklapa sa deklarisanim tipom.
5. **Fastify 5 traži `loggerInstance`** za gotovu pino instancu — sa `logger` servis uopšte ne startuje.
6. **Negativan `limit`** je tiho vraćao 1 red umesto podrazumevanih 50.

Druga runda, pri prvom pravom `docker compose up`:

7. **`%M` u ClickHouse-u je ime meseca, ne minut** — real-time grafik je pokazivao
   `06:August`, a spike detekcija je pravila neispravan `minute_utc` koji ide pravo
   u Postgres. Minut je `%i`.
8. **Alias koji senči kolonu, opet** — `formatDateTime(minute, …) AS minute` je rušio
   `/realtime` na istoj klasi greške kao ranije `toString(date) AS date`.
9. **Healthcheck na `localhost`** — u kontejneru se razrešava na IPv6 `::1`, a servisi
   vežu IPv4. ClickHouse je bio proglašen nezdravim iako radi.
10. **Healthcheck bez `start_period`** — ClickHouse pri prvom startu izvršava migracije
    preko privremenog servera; te sekunde su se brojale kao kvarovi.
11. **nginx keširа IP upstream-a sa starta** — svaki redeploy API-ja ga je obarao u 502.
    Sada razrešava preko Docker DNS-a u toku rada.
12. **Next.js standalone build** nije povlačio hoist-ovane zavisnosti (`outputFileTracingRoot`),
    a root `package.json` sa `"type": "module"` je rušio CommonJS `server.js`.
13. **`.env` se nije mogao `source`-ovati** — cron izrazi sa `*` su glob-ovali u imena fajlova.

---

## Namerna odstupanja od specifikacije

Tri mesta gde je implementacija svesno drugačija. Svako je zabeleženo i u kodu.

**1. `AggregatingMergeTree` umesto `SummingMergeTree` za materialized views.**
Spec predlaže `SummingMergeTree` + `uniqState`. `SummingMergeTree` garantuje sabiranje
numeričkih kolona, ali oslanjanje na njegovo ponašanje nad `AggregateFunction` kolonama
je rizik tačno one vrste na koju upozorava sekcija 15.3 — tiho pogrešnih brojeva.
`AggregatingMergeTree` + `SimpleAggregateFunction(sum, UInt64)` daje identičan rezultat
za brojače i korektno spaja uniq state-ove.

**2a. Geografija i presek kanala po entitetu čitaju se iz ClickHouse-a.**
Geo se ukršta sa autorom, kategorijom, tagom i kanalom. Predračunati sve te kombinacije
u Postgresu znači eksploziju redova (države × gradovi × kanali × autori × tagovi), a
ClickHouse baš takve preseke radi u milisekundama. Bez filtera po entitetu ide se na
`geo_daily` MV; sa filterom na sirove evente.

**2. Jedinstveni posetioci se za višednevne periode čitaju iz ClickHouse-a.**
Pravilo „dashboard čita Postgres" važi za sve osim ovoga: `unique_visitors` se **ne sabira**.
Isti čitalac u ponedeljak i sredu je jedan posetilac, a zbir dnevnih redova bi ga izbrojao
dvaput — greška koja raste sa dužinom perioda i ne vidi se golim okom.
`packages/api/src/uniques.js` radi `uniqMerge` nad malim dnevnim MV tabelama.
Dnevni i unapred izračunati nedeljni/mesečni redovi u Postgres-u su tačni sami za sebe.

**3. Tri kanala izvan osnovne liste: `email`, `messaging`, `app`.**
Sekcija 5.2 traži da se newsletter i app deep linkovi UTM-uju kako bi izašli iz „lažnog
direct-a" — što nema smisla ako nemaju svoj kanal da odu u njega.

**Dodato uz spec — geografija i kanal po entitetu.** Spec traži geo lookup na
ingestion-u (4.2) i traffic source attribution (5), ali nigde ne spaja to dvoje niti
izlaže geo u dashboard-u. Dodato je:

- `lat`/`lon` uz `country`/`city` — koordinate **centra grada** iz MaxMind-a, zaokružene
  na 2 decimale. Ne nose više informacije od samog imena grada; služe da mapa može da se
  nacrta bez spoljne usluge.
- `mv_geo_daily` — država × grad × kanal po danu. Kanal je u ključu namerno: „odakle
  geografski dolazi Facebook saobraćaj" je drugo pitanje od „odakle dolazi ukupan".
- `mv_tag_source_daily` — tagovi su jedini imali rupu; autori i kategorije su presek
  po kanalu već imali.
- `mv_geo_minute` (TTL 2 dana) — mapa uživo se osvežava na 10 sekundi, pa svaki
  refresh mora da bude jeftin.
- Ekrani `/geografija` (mapa, države, gradovi, uživo) i `/odakle-klikovi`.

**Teritorije.** `PULSE_COUNTRY_MERGE` (podrazumevano `XK:RS`) grupiše teritorije na
ingestion-u. Isto grupisanje je ugrađeno i u mapu, da tabela i mapa nikad ne pokazuju
različite brojeve. Menja se u `.env` plus ponovno generisanje mape.

Mapa je **ugrađena kao SVG** (`packages/dashboard/lib/world-map.js`, generisano iz
Natural Earth podataka skriptom `scripts/build-world-map.mjs`). Nema pločica sa tuđeg
servera: CSP je `default-src 'self'`, a i cela poenta je da podaci ne odlaze trećoj strani.

**Dodato uz spec:** `title` u `pulseMeta`. Bez naslova dashboard prikazuje ID-jeve članaka,
što nije upotrebljivo za urednika. Polje je opciono — ako izostane, SDK koristi `document.title`.

---

## Deployment: šta ide gde

Pulse je stateful pipeline. Skoro sve mora na server; serverless ne dolazi u obzir
za ingestion i worker.

| Komponenta | Gde | Zašto |
|---|---|---|
| ClickHouse, Redis, Postgres | server | trajni disk, dugotrajne konekcije |
| Ingestion API | server | spool fallback traži trajan fajl sistem; cilj p99 < 20ms ne trpi cold start |
| Worker | server | visi na `XREADGROUP ... BLOCK` — to nije funkcija nego proces |
| Cron | server | teški upiti nad ClickHouse-om, izvan limita serverless trajanja |
| Dashboard | server (ili Vercel) | jedini deo koji je čist client-side SPA |

Sve osim dashboarda podiže `docker compose up -d --build` na serveru iz sekcije 13.2.

### Demo na Vercelu (preporučeno ako treba javni prikaz)

```
Root Directory:  packages/dashboard
Env:             NEXT_PUBLIC_PULSE_DEMO = 1
```

Dashboard tada ne dodiruje nijedan backend — svi brojevi se generišu u pregledaču
(`packages/dashboard/lib/demo.js`), CSP je `connect-src 'self'`, i svaki ekran nosi
vidljivu oznaku da su podaci izmišljeni. API ostaje interni, bez CORS-a i bez izlaganja.

### Produkcijski dashboard na Vercelu (ako baš treba)

```
Root Directory:  packages/dashboard
Env:             NEXT_PUBLIC_API_URL = https://analitika.tvarenasport.com
```

Traži da API bude javno dostupan i da `API_CORS_ORIGIN` sadrži Vercel domen.
To je veća površina napada nego kad je sve iza jednog nginx-a — preporuka je da
dashboard ostane uz API, na istom hostu.

**Ingest, worker i cron nikad ne idu na Vercel.** Detalji u [SECURITY.md](SECURITY.md).

---

## Dokumentacija

| Dokument | Za koga |
|---|---|
| [docs/integracija-sajta.md](docs/integracija-sajta.md) | **Arena razvojni tim** — kako ubaciti `pulseMeta` i `pulse.js` |
| [docs/operativni-prirucnik.md](docs/operativni-prirucnik.md) | ko drži sistem — alerti, skaliranje, backup, kvarovi |
| [docs/citanje-izvestaja.md](docs/citanje-izvestaja.md) | urednici — šta koji broj znači i šta ne znači |
| [docs/api.md](docs/api.md) | integracije — REST endpointi |
| [SECURITY.md](SECURITY.md) | bezbednosna postavka: tajne, podaci o posetiocima, izloženost |

---

## Preduslov koji ne zavisi od ove platforme

`window.pulseMeta` na sajtu je **uslov** za analitiku po autoru, kategoriji i tagu.
Bez toga Pulse i dalje meri saobraćaj, ali ne zna čiji je tekst i o čemu je.
Ovo traži rad Arena razvojnog tima i treba dogovoriti na početku, ne na kraju —
vidi [docs/integracija-sajta.md](docs/integracija-sajta.md).
