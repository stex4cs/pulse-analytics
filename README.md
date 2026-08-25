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
ClickHouse                   sirovi eventi (90d TTL) + 18 materialized views
   │  cron: 5 min / noćno
   ▼
PostgreSQL                   dashboard-ready agregati
   ▼
Dashboard API (JWT, uloge)  →  Next.js dashboard
```

Ako Redis padne, ingest piše u lokalni append-only fajl i worker ga kasnije pokupi —
**event se ne gubi**.

---

## Brzi start

### 1. Podešavanje

```bash
cp .env.example .env
# Obavezno postavite: CLICKHOUSE_PASSWORD, POSTGRES_PASSWORD, IP_HASH_SECRET, JWT_SECRET
# Generisanje tajni:  openssl rand -base64 48
```

Za geo lookup preuzmite `GeoLite2-City.mmdb` (besplatan MaxMind nalog) u `geoip/`.
Bez toga sve radi, samo se država vadi iz CDN zaglavlja ako postoje.

### 2. Podizanje

```bash
docker compose up -d --build
docker compose logs -f worker          # prati da li batch-evi prolaze
```

ClickHouse i Postgres izvršavaju `db/*/*.sql` pri prvom startu. Za ručnu migraciju
na postojećoj instanci:

```bash
npm install
npm run migrate
```

### 3. Admin nalog

```bash
node scripts/seed.mjs --admin=urednik@tvarenasport.com --password='...'
```

### 4. Provera lanca

```bash
npm run smoke        # pošalje event i proveri da je stigao do ClickHouse-a
```

Smoke test proverava i obradu na serveru: attribution, UA parsing, izvedeni
`category_root`, consent i materialized views.

### 5. Dashboard

`http://localhost:3000` (u produkciji `analitika.tvarenasport.com`).
Grafana je na `:3001`.

### Lokalni razvoj bez saobraćaja

```bash
node scripts/seed.mjs --demo=14                    # 14 dana sintetičkog saobraćaja
npm run -w @pulse/cron run-once -- articles 30
npm run -w @pulse/cron run-once -- daily 2026-08-10 2026-08-24
```

---

## Struktura repozitorijuma

```
db/clickhouse/       šema + 18 materialized views
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

---

## Namerna odstupanja od specifikacije

Tri mesta gde je implementacija svesno drugačija. Svako je zabeleženo i u kodu.

**1. `AggregatingMergeTree` umesto `SummingMergeTree` za materialized views.**
Spec predlaže `SummingMergeTree` + `uniqState`. `SummingMergeTree` garantuje sabiranje
numeričkih kolona, ali oslanjanje na njegovo ponašanje nad `AggregateFunction` kolonama
je rizik tačno one vrste na koju upozorava sekcija 15.3 — tiho pogrešnih brojeva.
`AggregatingMergeTree` + `SimpleAggregateFunction(sum, UInt64)` daje identičan rezultat
za brojače i korektno spaja uniq state-ove.

**2. Jedinstveni posetioci se za višednevne periode čitaju iz ClickHouse-a.**
Pravilo „dashboard čita Postgres" važi za sve osim ovoga: `unique_visitors` se **ne sabira**.
Isti čitalac u ponedeljak i sredu je jedan posetilac, a zbir dnevnih redova bi ga izbrojao
dvaput — greška koja raste sa dužinom perioda i ne vidi se golim okom.
`packages/api/src/uniques.js` radi `uniqMerge` nad malim dnevnim MV tabelama.
Dnevni i unapred izračunati nedeljni/mesečni redovi u Postgres-u su tačni sami za sebe.

**3. Tri kanala izvan osnovne liste: `email`, `messaging`, `app`.**
Sekcija 5.2 traži da se newsletter i app deep linkovi UTM-uju kako bi izašli iz „lažnog
direct-a" — što nema smisla ako nemaju svoj kanal da odu u njega.

**Dodato uz spec:** `title` u `pulseMeta`. Bez naslova dashboard prikazuje ID-jeve članaka,
što nije upotrebljivo za urednika. Polje je opciono — ako izostane, SDK koristi `document.title`.

---

## Dokumentacija

| Dokument | Za koga |
|---|---|
| [docs/integracija-sajta.md](docs/integracija-sajta.md) | **Arena razvojni tim** — kako ubaciti `pulseMeta` i `pulse.js` |
| [docs/operativni-prirucnik.md](docs/operativni-prirucnik.md) | ko drži sistem — alerti, skaliranje, backup, kvarovi |
| [docs/citanje-izvestaja.md](docs/citanje-izvestaja.md) | urednici — šta koji broj znači i šta ne znači |
| [docs/api.md](docs/api.md) | integracije — REST endpointi |

---

## Preduslov koji ne zavisi od ove platforme

`window.pulseMeta` na sajtu je **uslov** za analitiku po autoru, kategoriji i tagu.
Bez toga Pulse i dalje meri saobraćaj, ali ne zna čiji je tekst i o čemu je.
Ovo traži rad Arena razvojnog tima i treba dogovoriti na početku, ne na kraju —
vidi [docs/integracija-sajta.md](docs/integracija-sajta.md).
