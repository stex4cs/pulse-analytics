# Pulse — operativni priručnik

Za onoga ko drži sistem. Podeljeno po tome šta se dogodilo, ne po komponentama.

---

## Servisi

| Servis | Port | Šta radi | Sme li da padne |
|---|---|---|---|
| `ingest-1`, `ingest-2` | 8080 | prima `/collect` | ne — gubi se saobraćaj |
| `worker` | 9101 (metrike) | Redis → ClickHouse | kratko da, eventi čekaju u Redis-u |
| `cron` | 9102 (metrike) | agregacije, spike, A/B | da — dashboard zastari, podaci ostaju |
| `api` | 8081 | dashboard backend | da — samo dashboard ne radi |
| `dashboard` | 3000 | Next.js | da |
| `clickhouse` | 8123 / 9363 | sirovi eventi | ne |
| `redis` | 6379 | buffer | kratko — ingest prelazi na spool fajl |
| `postgres` | 5432 | agregati | da — merenje se nastavlja |

Provera zdravlja u jednoj komandi:

```bash
docker compose ps
curl -s localhost:8080/health
curl -s localhost:8081/health
curl -s localhost:8080/metrics | grep pulse_queue_depth
```

---

## Alerti i šta se radi

### `PulseQueueDepthHigh` — red preko 50.000

Worker ne stiže. Najčešće tokom derbija.

```bash
docker compose up -d --scale worker=3
docker compose logs --tail=100 worker
```

Ako i to ne pomaže, uzrok je ClickHouse, ne worker:

```bash
curl -s localhost:8080/metrics | grep pulse_clickhouse_insert_errors_total
docker compose logs --tail=200 clickhouse
```

**Ne restartujte worker dok red raste** — poruke u PEL-u se preuzimaju tek posle
60 sekundi (`XAUTOCLAIM`), pa restart privremeno usporava obradu.

### `PulseSpoolFallbackActive` — ingest piše u fajl

Redis je nedostupan. Eventi nisu izgubljeni: idu u `/var/lib/pulse/spool/*.ndjson`,
a worker ih pokupi automatski čim se Redis vrati (proverava svakih 60s).

```bash
docker compose logs --tail=50 redis
docker compose restart redis
docker compose exec worker ls -la /var/lib/pulse/spool/
```

Fajl se briše tek posle uspešnog upisa u ClickHouse.

### `PulseCronStale` — agregacija starija od 15 minuta

Dashboard prikazuje zastarele brojeve; sirovi podaci su netaknuti.

```bash
docker compose logs --tail=100 cron
docker compose exec postgres psql -U pulse -d pulse \
  -c "SELECT job_name, status, error, started_at FROM job_runs ORDER BY started_at DESC LIMIT 10;"
```

Ručno pokretanje posla:

```bash
docker compose exec cron node packages/cron/src/cli.js daily 2026-08-24 2026-08-24
```

Noćni prolaz sam radi backfill od poslednjeg vodožiga (`job_watermarks`), pa
propušteni sati nisu trajno izgubljeni.

### `PulseNoTraffic` — nijedan event 10 minuta

Prvo proverite da li je tag i dalje na sajtu:

```bash
curl -s https://tvarenasport.com/ | grep -c pulse.js
```

Ako jeste, problem je između nginx-a i ingest-a:

```bash
docker compose logs --tail=100 nginx | grep collect
```

### `PulseIngestLatencyHigh` — p99 preko 20 ms

Skoro uvek Redis ili geo lookup. `/collect` odgovara pre nego što čeka Redis,
pa visok p99 znači da je sama obrada spora:

```bash
curl -s localhost:8080/metrics | grep pulse_ingest_duration_seconds
docker compose exec redis redis-cli --latency
```

### `PulseRejectedEventsSpike` — više od 10% eventa se odbacuje

Najčešće posle izmene na sajtu.

```bash
curl -s localhost:8080/metrics | grep pulse_ingest_rejected_events_total
```

Labela `reason` kaže šta je: `missing_session_id`, `bad_timestamp`,
`unknown_event_type`, `missing_url`, `bad_scroll_depth`.

---

## Backup

### Postgres — ovo je ono što ne sme da se izgubi

Agregati su jedino što se ne može rekonstruisati posle isteka 90-dnevnog TTL-a
na sirovim eventima.

```bash
docker compose exec -T postgres pg_dump -U pulse pulse | gzip > pulse-pg-$(date +%F).sql.gz
```

Dnevno, offsite. Vraćanje:

```bash
gunzip -c pulse-pg-2026-08-24.sql.gz | docker compose exec -T postgres psql -U pulse -d pulse
```

### ClickHouse — nedeljno, manje kritično

```bash
docker compose exec clickhouse clickhouse-client --query \
  "ALTER TABLE pulse.events FREEZE PARTITION '202608'"
# snapshot je u /var/lib/clickhouse/shadow/
```

### Redis

AOF je uključen, ali Redis je samo buffer — gubitak nekoliko sekundi eventa nije
razlog za restore.

---

## Rutinske provere

**Rast diska** (procena: 15–25 GB/mesečno sirovih eventa, stabilizuje se na 50–75 GB
sa 90-dnevnim TTL-om):

```bash
docker compose exec clickhouse clickhouse-client --query "
SELECT table, formatReadableSize(sum(bytes_on_disk)) AS size, sum(rows) AS rows
FROM system.parts WHERE database='pulse' AND active
GROUP BY table ORDER BY sum(bytes_on_disk) DESC"
```

**Da li TTL zaista briše** (klik eventi 30 dana, ostalo 90):

```bash
docker compose exec clickhouse clickhouse-client --query "
SELECT event_type, min(date) AS najstariji, count() AS n
FROM pulse.events GROUP BY event_type ORDER BY n DESC"
```

**Udeo botova** (normalno 10–30%; nagli skok znači novi crawler):

```bash
docker compose exec clickhouse clickhouse-client --query "
SELECT bot_reason, count() FROM pulse.events
WHERE timestamp >= now() - INTERVAL 24 HOUR AND is_bot = 1
GROUP BY bot_reason ORDER BY 2 DESC"
```

**Clock skew** (veliki pomeraji znače pokvarene klijentske satove ili bot-farmu):

```bash
docker compose exec clickhouse clickhouse-client --query "
SELECT quantiles(0.5, 0.95, 0.99)(abs(clock_skew_ms)) FROM pulse.events
WHERE timestamp >= now() - INTERVAL 1 HOUR"
```

---

## GDPR zahtevi

**Brisanje posetioca** (član 17):

```bash
curl -X DELETE https://analitika.tvarenasport.com/api/gdpr/visitor/<visitor_id> \
  -H "Authorization: Bearer <admin-token>"
```

Vraća `202` — `ALTER … DELETE` u ClickHouse-u je asinhrona mutacija.
Praćenje:

```bash
docker compose exec clickhouse clickhouse-client --query \
  "SELECT command, is_done, latest_fail_reason FROM system.mutations WHERE table='events'"
```

Agregati se ne diraju — anonimni su i ne sadrže `visitor_id`.

**Uvid u podatke** (član 15): `GET /api/gdpr/visitor/<visitor_id>`.

**IP adrese se nikad ne čuvaju.** U bazi postoji samo dnevno-salted hash za bot
detekciju; salt se menja u ponoć UTC, pa se posetilac ne može pratiti između dana.

---

## Održavanje

### Redeploy servisa

API i dashboard se mogu redeploy-ovati bez diranja nginx-a — nginx ih razrešava
preko Docker DNS-a u toku rada:

```bash
docker compose up -d --build api dashboard
```

**Ingest je izuzetak.** Njegov `upstream` blok zadržava `keepalive` i `least_conn`
(vredi više na 2000 req/s nego automatski re-resolve), a nginx OSS razrešava
upstream servere samo pri startu. Posle redeploy-a ingest-a:

```bash
docker compose up -d --build ingest-1 ingest-2
docker compose restart nginx          # bez ovoga: 502 na /collect
```

### Rotacija tajni

`IP_HASH_SECRET` — promena je bezbedna, prekida povezivanje hash-eva starih i novih dana
(što je i poenta). `JWT_SECRET` — promena odjavljuje sve korisnike.

### Dodavanje regionalnog domena

Kolona `site` postoji svuda od početka, pa migracija nije potrebna:

1. u `.env` dodajte TLD u `PULSE_SITES` i `PULSE_INTERNAL_DOMAINS`
2. `docker compose up -d`
3. korisnicima dodajte sajt: `PATCH /api/users/:id` sa `{"sites": ["rs","hr"]}`

### Nadogradnja ClickHouse šeme

Migracije su idempotentne (`CREATE … IF NOT EXISTS`):

```bash
npm run migrate -- --only=clickhouse
```

Nova materialized view **ne popunjava istorijske podatke** — vidi samo nove
insert-e. Za popunjavanje unazad koristi se `INSERT INTO … SELECT` nad ciljnom
tabelom, sa datumskim opsegom.

### Load test pre velike utakmice

```bash
npm run loadtest
```

Profil: 300 req/s mirno stanje, pa skok na 2000 req/s. Posle testa obavezno očistiti:

```bash
docker compose exec clickhouse clickhouse-client --query \
  "ALTER TABLE pulse.events DELETE WHERE has(tags, 'load-test')"
```

---

## Kad ništa nije jasno

Redosled provere, od kraja lanca ka početku:

```bash
# 1. Da li podaci uopšte stižu?
docker compose exec clickhouse clickhouse-client --query \
  "SELECT count(), max(timestamp) FROM pulse.events WHERE timestamp >= now() - INTERVAL 5 MINUTE"

# 2. Ako ne — da li čekaju u Redis-u?
docker compose exec redis redis-cli XINFO STREAM pulse:events

# 3. Ako ni tamo — da li ingest prima?
curl -s localhost:8080/metrics | grep pulse_ingest_requests_total

# 4. Ako ni to — da li nginx prosleđuje?
docker compose logs --tail=50 nginx | grep collect
```

Zdravlje celog pipeline-a je i u dashboard-u: **Admin → `/api/system/health`**
vraća poslednji status svakog cron posla i brojeve iz ClickHouse-a za 24h.
