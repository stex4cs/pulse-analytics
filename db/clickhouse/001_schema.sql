-- ============================================================================
-- Pulse - ClickHouse sema (sekcija 6.1)
-- Sirovi eventi, 90 dana TTL. Klik eventi 30 dana (sekcija 9.1 / 12.3).
-- ============================================================================

CREATE DATABASE IF NOT EXISTS pulse;

CREATE TABLE IF NOT EXISTS pulse.events
(
    event_id            UUID,
    event_type          LowCardinality(String),
    timestamp           DateTime64(3, 'UTC'),
    date                Date MATERIALIZED toDate(timestamp),

    -- klijentski timestamp -> detekcija clock skew-a (sekcija 3.2)
    client_timestamp    DateTime64(3, 'UTC'),
    clock_skew_ms       Int32,

    -- identitet
    session_id          String,
    visitor_id          String,
    is_new_visitor      UInt8,
    has_consent         UInt8,

    -- sadrzaj
    site                LowCardinality(String),
    url                 String,
    path                String,
    article_id          String,
    title               String,
    author              LowCardinality(String),
    category            LowCardinality(String),
    category_root       LowCardinality(String) MATERIALIZED splitByChar('/', category)[1],
    tags                Array(LowCardinality(String)),
    content_type        LowCardinality(String),
    published_at        Nullable(DateTime),
    word_count          UInt16,

    -- akvizicija
    referrer_domain     LowCardinality(String),
    traffic_source      LowCardinality(String),
    channel_detail      String,
    utm_source          LowCardinality(String),
    utm_medium          LowCardinality(String),
    utm_campaign        String,

    -- tehnicki
    device_type         LowCardinality(String),
    browser             LowCardinality(String),
    os                  LowCardinality(String),
    country             LowCardinality(String),
    city                String,
    ip_hash             String,

    -- event-specific
    scroll_depth        UInt8,
    active_time_ms      UInt32,
    click_selector      String,
    click_x             UInt16,
    click_y             UInt16,
    viewport_width      UInt16,
    viewport_bucket     UInt16,
    video_progress      UInt8,
    ab_test_id          String,
    ab_variant          String,

    is_bot              UInt8 DEFAULT 0,
    bot_reason          LowCardinality(String) DEFAULT '',

    INDEX idx_author  author         TYPE set(0)              GRANULARITY 4,
    INDEX idx_source  traffic_source TYPE set(0)              GRANULARITY 4,
    INDEX idx_session session_id     TYPE bloom_filter(0.01)  GRANULARITY 4,
    INDEX idx_visitor visitor_id     TYPE bloom_filter(0.01)  GRANULARITY 4
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (date, category_root, article_id, timestamp)
TTL date + INTERVAL 90 DAY,
    date + INTERVAL 30 DAY DELETE WHERE event_type = 'click'
SETTINGS index_granularity = 8192;

-- ---------------------------------------------------------------------------
-- Sesije: bounce rate i stranica-po-sesiji (sekcija 10.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.sessions
(
    date                Date,
    site                LowCardinality(String),
    session_id          String,
    visitor_id          SimpleAggregateFunction(any, String),
    started_at          SimpleAggregateFunction(min, DateTime64(3, 'UTC')),
    ended_at            SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    pageviews           SimpleAggregateFunction(sum, UInt64),
    active_time_ms      SimpleAggregateFunction(sum, UInt64),
    traffic_source      SimpleAggregateFunction(any, String),
    channel_detail      SimpleAggregateFunction(any, String),
    device_type         SimpleAggregateFunction(any, String),
    country             SimpleAggregateFunction(any, String),
    entry_category_root SimpleAggregateFunction(any, String),
    entry_path          SimpleAggregateFunction(any, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, session_id)
TTL date + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_sessions TO pulse.sessions AS
SELECT
    toDate(timestamp)                       AS date,
    site,
    session_id,
    any(visitor_id)                         AS visitor_id,
    min(timestamp)                          AS started_at,
    max(timestamp)                          AS ended_at,
    toUInt64(countIf(event_type = 'pageview')) AS pageviews,
    toUInt64(sum(active_time_ms))           AS active_time_ms,
    any(traffic_source)                     AS traffic_source,
    any(channel_detail)                     AS channel_detail,
    any(device_type)                        AS device_type,
    any(country)                            AS country,
    any(category_root)                      AS entry_category_root,
    any(path)                               AS entry_path
FROM pulse.events
WHERE is_bot = 0
GROUP BY date, site, session_id;

-- ---------------------------------------------------------------------------
-- A/B test: izlozenosti i klikovi (sekcija 8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.ab_events
(
    date        Date,
    site        LowCardinality(String),
    ab_test_id  String,
    ab_variant  String,
    impressions UInt64,
    clicks      UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, ab_test_id, ab_variant)
TTL date + INTERVAL 365 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_ab_events TO pulse.ab_events AS
SELECT
    toDate(timestamp)                                AS date,
    site,
    ab_test_id,
    ab_variant,
    toUInt64(countIf(event_type = 'ab_exposure'))    AS impressions,
    toUInt64(countIf(event_type = 'pageview'))       AS clicks
FROM pulse.events
WHERE is_bot = 0 AND ab_test_id != ''
GROUP BY date, site, ab_test_id, ab_variant;

-- ---------------------------------------------------------------------------
-- Heatmapa klikova, normalizovano po viewport bucket-u (sekcija 9.1)
-- Samo uz consent; TTL 30 dana jer zauzima najvise prostora.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.heatmap_clicks
(
    date            Date,
    site            LowCardinality(String),
    article_id      String,
    viewport_bucket UInt16,
    x_cell          UInt16,
    y_cell          UInt16,
    clicks          UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(date)
ORDER BY (date, site, article_id, viewport_bucket, y_cell, x_cell)
TTL date + INTERVAL 30 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_heatmap_clicks TO pulse.heatmap_clicks AS
SELECT
    toDate(timestamp)       AS date,
    site,
    article_id,
    viewport_bucket,
    toUInt16(intDiv(click_x, 10)) AS x_cell,
    toUInt16(intDiv(click_y, 10)) AS y_cell,
    toUInt64(count())       AS clicks
FROM pulse.events
WHERE event_type = 'click' AND is_bot = 0 AND article_id != '' AND has_consent = 1
GROUP BY date, site, article_id, viewport_bucket, x_cell, y_cell;

-- ---------------------------------------------------------------------------
-- Minutni puls: real-time widget + spike detekcija (sekcija 9.4 / 10.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pulse.minute_pulse
(
    minute          DateTime,
    site            LowCardinality(String),
    category_root   LowCardinality(String),
    pageviews       SimpleAggregateFunction(sum, UInt64),
    sessions_state  AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMMDD(minute)
ORDER BY (minute, site, category_root)
TTL minute + INTERVAL 14 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS pulse.mv_minute_pulse TO pulse.minute_pulse AS
SELECT
    toStartOfMinute(timestamp)  AS minute,
    site,
    category_root,
    toUInt64(count())           AS pageviews,
    uniqState(session_id)       AS sessions_state
FROM pulse.events
WHERE event_type = 'pageview' AND is_bot = 0
GROUP BY minute, site, category_root;
