-- ============================================================================
-- Pulse - materialized views (sekcija 6.2)
--
-- ODSTUPANJE OD SPECIFIKACIJE, namerno:
-- spec predlaze SummingMergeTree + uniqState. SummingMergeTree garantuje
-- sabiranje numerickih kolona, ali ponasanje nad AggregateFunction kolonama
-- nije ono sto zelimo da se oslanjamo na njega. AggregatingMergeTree +
-- SimpleAggregateFunction(sum, UInt64) daje identican rezultat za brojace
-- i korektno merge-uje uniq state-ove. Sekcija 15.3 upozorava tacno na ovu
-- klasu tihih gresaka, pa biramo eksplicitno tacan engine.
--
-- Citanje: uvek uniqMerge(...) nad *_state kolonama, nikad sum().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Pregledi po clanku po satu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.article_hourly
(
    hour                DateTime,
    site                LowCardinality(String),
    article_id          String,
    author              LowCardinality(String),
    category            LowCardinality(String),
    content_type        LowCardinality(String),
    title               SimpleAggregateFunction(anyLast, String),
    tags                SimpleAggregateFunction(anyLast, Array(String)),
    url                 SimpleAggregateFunction(anyLast, String),
    word_count          SimpleAggregateFunction(anyLast, UInt16),
    published_at        SimpleAggregateFunction(max, DateTime),
    pageviews           SimpleAggregateFunction(sum, UInt64),
    sessions_state      AggregateFunction(uniq, String),
    visitors_state      AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, site, article_id)
TTL hour + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_article_hourly TO pulse.article_hourly AS
SELECT
    toStartOfHour(timestamp)    AS hour,
    site,
    article_id,
    author,
    category,
    content_type,
    anyLast(title)              AS title,
    anyLast(CAST(tags AS Array(String))) AS tags,
    anyLast(url)                AS url,
    anyLast(word_count)         AS word_count,
    max(ifNull(published_at, toDateTime(0))) AS published_at,
    toUInt64(count())           AS pageviews,
    uniqState(session_id)       AS sessions_state,
    uniqState(visitor_id)       AS visitors_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0
GROUP BY hour, site, article_id, author, category, content_type;

-- ---------------------------------------------------------------------------
-- Pregledi po autoru po danu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.author_daily
(
    date            Date,
    site            LowCardinality(String),
    author          LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String),
    visitors_state  AggregateFunction(uniq, String),
    articles_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, author)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_author_daily TO pulse.author_daily AS
SELECT
    toDate(timestamp)       AS date,
    site,
    author,
    toUInt64(count())       AS pageviews,
    uniqState(session_id)   AS sessions_state,
    uniqState(visitor_id)   AS visitors_state,
    uniqState(article_id)   AS articles_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND author != ''
GROUP BY date, site, author;

-- ---------------------------------------------------------------------------
-- Pregledi po kategoriji po danu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.category_daily
(
    date            Date,
    site            LowCardinality(String),
    category        LowCardinality(String),
    category_root   LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String),
    visitors_state  AggregateFunction(uniq, String),
    articles_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, category_root, category)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_category_daily TO pulse.category_daily AS
SELECT
    toDate(timestamp)       AS date,
    site,
    category,
    category_root,
    toUInt64(count())       AS pageviews,
    uniqState(session_id)   AS sessions_state,
    uniqState(visitor_id)   AS visitors_state,
    uniqState(article_id)   AS articles_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND category != ''
GROUP BY date, site, category, category_root;

-- ---------------------------------------------------------------------------
-- Pregledi po tagu po danu (ARRAY JOIN nad tags)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.tag_daily
(
    date            Date,
    site            LowCardinality(String),
    tag             LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String),
    articles_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, tag)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_tag_daily TO pulse.tag_daily AS
SELECT
    toDate(timestamp)       AS date,
    site,
    tag,
    toUInt64(count())       AS pageviews,
    uniqState(session_id)   AS sessions_state,
    uniqState(article_id)   AS articles_state
FROM pulse.events
ARRAY JOIN tags AS tag
WHERE event_type = 'pageview' AND is_bot = 0
GROUP BY date, site, tag;

-- Satni tag agregat -> trending score (sekcija 9.3)
CREATE TABLE IF NOT EXISTS pulse.tag_hourly
(
    hour        DateTime,
    site        LowCardinality(String),
    tag         LowCardinality(String),
    pageviews   SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, site, tag)
TTL hour + INTERVAL 30 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_tag_hourly TO pulse.tag_hourly AS
SELECT
    toStartOfHour(timestamp) AS hour,
    site,
    tag,
    toUInt64(count())        AS pageviews
FROM pulse.events
ARRAY JOIN tags AS tag
WHERE event_type = 'pageview' AND is_bot = 0
GROUP BY hour, site, tag;

-- ---------------------------------------------------------------------------
-- Traffic source po danu x kategoriji x device (sekcija 10.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.source_daily
(
    date            Date,
    site            LowCardinality(String),
    traffic_source  LowCardinality(String),
    category_root   LowCardinality(String),
    device_type     LowCardinality(String),
    country         LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String),
    visitors_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, traffic_source, category_root, device_type, country)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_source_daily TO pulse.source_daily AS
SELECT
    toDate(timestamp)       AS date,
    site,
    traffic_source,
    category_root,
    device_type,
    country,
    toUInt64(count())       AS pageviews,
    uniqState(session_id)   AS sessions_state,
    uniqState(visitor_id)   AS visitors_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0
GROUP BY date, site, traffic_source, category_root, device_type, country;

-- UTM kampanje (sekcija 10.5, paid tabela)
CREATE TABLE IF NOT EXISTS pulse.campaign_daily
(
    date            Date,
    site            LowCardinality(String),
    utm_source      LowCardinality(String),
    utm_medium      LowCardinality(String),
    utm_campaign    String,
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, utm_source, utm_medium, utm_campaign)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_campaign_daily TO pulse.campaign_daily AS
SELECT
    toDate(timestamp)       AS date,
    site,
    utm_source,
    utm_medium,
    utm_campaign,
    toUInt64(count())       AS pageviews,
    uniqState(session_id)   AS sessions_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND utm_campaign != ''
GROUP BY date, site, utm_source, utm_medium, utm_campaign;

-- ---------------------------------------------------------------------------
-- Scroll depth + engagement po clanku po danu (sekcija 9.2)
-- read_completion: 75%+ scroll I aktivno vreme >= word_count/200 min
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.engagement_daily
(
    date                Date,
    site                LowCardinality(String),
    article_id          String,
    author              LowCardinality(String),
    category            LowCardinality(String),
    content_type        LowCardinality(String),
    reached_25          SimpleAggregateFunction(sum, UInt64),
    reached_50          SimpleAggregateFunction(sum, UInt64),
    reached_75          SimpleAggregateFunction(sum, UInt64),
    reached_100         SimpleAggregateFunction(sum, UInt64),
    scroll_sessions     AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, article_id)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_engagement_daily TO pulse.engagement_daily AS
SELECT
    toDate(timestamp)                       AS date,
    site,
    article_id,
    author,
    category,
    content_type,
    toUInt64(countIf(scroll_depth >= 25))   AS reached_25,
    toUInt64(countIf(scroll_depth >= 50))   AS reached_50,
    toUInt64(countIf(scroll_depth >= 75))   AS reached_75,
    toUInt64(countIf(scroll_depth >= 100))  AS reached_100,
    uniqState(session_id)                   AS scroll_sessions
FROM pulse.events
WHERE event_type = 'scroll_depth' AND is_bot = 0 AND article_id != ''
GROUP BY date, site, article_id, author, category, content_type;

-- Vreme na stranici po clanku po danu
CREATE TABLE IF NOT EXISTS pulse.timeonpage_daily
(
    date                Date,
    site                LowCardinality(String),
    article_id          String,
    author              LowCardinality(String),
    category            LowCardinality(String),
    content_type        LowCardinality(String),
    samples             SimpleAggregateFunction(sum, UInt64),
    active_time_ms_sum  SimpleAggregateFunction(sum, UInt64),
    read_completions    SimpleAggregateFunction(sum, UInt64),
    active_time_quant   AggregateFunction(quantiles(0.5, 0.9), UInt32)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, article_id)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_timeonpage_daily TO pulse.timeonpage_daily AS
SELECT
    toDate(timestamp)                   AS date,
    site,
    article_id,
    author,
    category,
    content_type,
    toUInt64(count())                   AS samples,
    toUInt64(sum(active_time_ms))       AS active_time_ms_sum,
    toUInt64(countIf(
        scroll_depth >= 75
        AND word_count > 0
        AND active_time_ms >= (word_count / 200.0) * 60000
    ))                                  AS read_completions,
    quantilesState(0.5, 0.9)(active_time_ms) AS active_time_quant
FROM pulse.events
WHERE event_type = 'time_on_page' AND is_bot = 0 AND article_id != ''
GROUP BY date, site, article_id, author, category, content_type;

-- ---------------------------------------------------------------------------
-- Video engagement (sekcija 3.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.video_daily
(
    date        Date,
    site        LowCardinality(String),
    article_id  String,
    plays       SimpleAggregateFunction(sum, UInt64),
    p25         SimpleAggregateFunction(sum, UInt64),
    p50         SimpleAggregateFunction(sum, UInt64),
    p75         SimpleAggregateFunction(sum, UInt64),
    p100        SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, article_id)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_video_daily TO pulse.video_daily AS
SELECT
    toDate(timestamp)                                                       AS date,
    site,
    article_id,
    toUInt64(countIf(event_type = 'video_play'))                            AS plays,
    toUInt64(countIf(event_type = 'video_progress' AND video_progress >= 25))  AS p25,
    toUInt64(countIf(event_type = 'video_progress' AND video_progress >= 50))  AS p50,
    toUInt64(countIf(event_type = 'video_progress' AND video_progress >= 75))  AS p75,
    toUInt64(countIf(event_type = 'video_progress' AND video_progress >= 100)) AS p100
FROM pulse.events
WHERE is_bot = 0 AND event_type IN ('video_play', 'video_progress')
GROUP BY date, site, article_id;

-- ---------------------------------------------------------------------------
-- Live blog engagement (sekcija 15.5 - odvojen obrazac)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.liveblog_hourly
(
    hour            DateTime,
    site            LowCardinality(String),
    article_id      String,
    updates_seen    SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, site, article_id)
TTL hour + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_liveblog_hourly TO pulse.liveblog_hourly AS
SELECT
    toStartOfHour(timestamp)    AS hour,
    site,
    article_id,
    toUInt64(count())           AS updates_seen,
    uniqState(session_id)       AS sessions_state
FROM pulse.events
WHERE event_type = 'live_blog_update' AND is_bot = 0
GROUP BY hour, site, article_id;

-- ---------------------------------------------------------------------------
-- First touch / last touch po posetiocu (sekcija 5.4, priprema za fazu 2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.visitor_touch
(
    site                LowCardinality(String),
    visitor_id          String,
    first_seen          SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    last_seen           SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    first_touch_source  AggregateFunction(argMin, String, DateTime64(3, 'UTC')),
    last_touch_source   AggregateFunction(argMax, String, DateTime64(3, 'UTC')),
    sessions_state      AggregateFunction(uniq, String),
    pageviews           SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
ORDER BY (site, visitor_id)
TTL toDate(last_seen) + INTERVAL 365 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_visitor_touch TO pulse.visitor_touch AS
SELECT
    site,
    visitor_id,
    min(timestamp)                              AS first_seen,
    max(timestamp)                              AS last_seen,
    argMinState(toString(traffic_source), timestamp) AS first_touch_source,
    argMaxState(toString(traffic_source), timestamp) AS last_touch_source,
    uniqState(session_id)                       AS sessions_state,
    toUInt64(count())                           AS pageviews
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND visitor_id != ''
GROUP BY site, visitor_id;

-- ---------------------------------------------------------------------------
-- Source breakdown po autoru / kategoriji / clanku.
-- Bez ovoga bi cron morao da svakih 5 minuta cesljao sirove evente da bi
-- popunio source_breakdown JSONB kolone u Postgres-u.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.author_source_daily
(
    date            Date,
    site            LowCardinality(String),
    author          LowCardinality(String),
    traffic_source  LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, author, traffic_source)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_author_source_daily TO pulse.author_source_daily AS
SELECT toDate(timestamp) AS date, site, author, traffic_source, toUInt64(count()) AS pageviews
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND author != ''
GROUP BY date, site, author, traffic_source;

CREATE TABLE IF NOT EXISTS pulse.category_source_daily
(
    date            Date,
    site            LowCardinality(String),
    category        LowCardinality(String),
    category_root   LowCardinality(String),
    traffic_source  LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, category, traffic_source)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_category_source_daily TO pulse.category_source_daily AS
SELECT toDate(timestamp) AS date, site, category, category_root, traffic_source, toUInt64(count()) AS pageviews
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND category != ''
GROUP BY date, site, category, category_root, traffic_source;

CREATE TABLE IF NOT EXISTS pulse.article_source_daily
(
    date            Date,
    site            LowCardinality(String),
    article_id      String,
    traffic_source  LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, article_id, traffic_source)
TTL date + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_article_source_daily TO pulse.article_source_daily AS
SELECT toDate(timestamp) AS date, site, article_id, traffic_source, toUInt64(count()) AS pageviews
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0 AND article_id != ''
GROUP BY date, site, article_id, traffic_source;
