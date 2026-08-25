-- ============================================================================
-- Pulse - PostgreSQL sema (sekcija 7 + 8 + 11)
-- Dashboard cita ODAVDE. ClickHouse se dira samo za ad-hoc drill-down.
-- Sva vremena u UTC (sekcija 15.4).
-- ============================================================================

SET timezone = 'UTC';

-- ---------------------------------------------------------------------------
-- Agregati
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS author_stats (
    id                          BIGSERIAL PRIMARY KEY,
    site                        VARCHAR(4)   NOT NULL,
    author                      VARCHAR(120) NOT NULL,
    period_type                 VARCHAR(10)  NOT NULL,
    period_start                DATE         NOT NULL,
    pageviews                   BIGINT       NOT NULL DEFAULT 0,
    unique_visitors             BIGINT       NOT NULL DEFAULT 0,
    articles_published          INT          NOT NULL DEFAULT 0,
    avg_pageviews_per_article   NUMERIC(12,2),
    avg_time_on_page_sec        NUMERIC(10,2),
    avg_scroll_completion       NUMERIC(5,2),
    read_completion_rate        NUMERIC(5,2),
    source_breakdown            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (site, author, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_author_stats_period
    ON author_stats (period_type, period_start DESC, pageviews DESC);

CREATE TABLE IF NOT EXISTS category_stats (
    id                          BIGSERIAL PRIMARY KEY,
    site                        VARCHAR(4)   NOT NULL,
    category                    VARCHAR(200) NOT NULL,
    category_root               VARCHAR(80)  NOT NULL,
    period_type                 VARCHAR(10)  NOT NULL,
    period_start                DATE         NOT NULL,
    pageviews                   BIGINT       NOT NULL DEFAULT 0,
    unique_visitors             BIGINT       NOT NULL DEFAULT 0,
    articles_published          INT          NOT NULL DEFAULT 0,
    avg_pageviews_per_article   NUMERIC(12,2),
    avg_time_on_page_sec        NUMERIC(10,2),
    avg_scroll_completion       NUMERIC(5,2),
    read_completion_rate        NUMERIC(5,2),
    source_breakdown            JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (site, category, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_category_stats_period
    ON category_stats (period_type, period_start DESC, pageviews DESC);
CREATE INDEX IF NOT EXISTS idx_category_stats_root
    ON category_stats (site, category_root, period_type, period_start DESC);

CREATE TABLE IF NOT EXISTS tag_stats (
    id                  BIGSERIAL PRIMARY KEY,
    site                VARCHAR(4)   NOT NULL,
    tag                 VARCHAR(160) NOT NULL,
    period_type         VARCHAR(10)  NOT NULL,
    period_start        DATE         NOT NULL,
    pageviews           BIGINT       NOT NULL DEFAULT 0,
    unique_visitors     BIGINT       NOT NULL DEFAULT 0,
    articles_count      INT          NOT NULL DEFAULT 0,
    trending_score      NUMERIC(12,4) NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (site, tag, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_tag_stats_trending
    ON tag_stats (site, period_type, period_start DESC, trending_score DESC);

CREATE TABLE IF NOT EXISTS article_stats (
    site                    VARCHAR(4)   NOT NULL,
    article_id              VARCHAR(40)  NOT NULL,
    title                   TEXT,
    url                     TEXT,
    author                  VARCHAR(120),
    category                VARCHAR(200),
    category_root           VARCHAR(80),
    content_type            VARCHAR(20),
    tags                    TEXT[]       NOT NULL DEFAULT '{}',
    word_count              INT,
    published_at            TIMESTAMPTZ,
    pageviews_total         BIGINT       NOT NULL DEFAULT 0,
    pageviews_1h            BIGINT       NOT NULL DEFAULT 0,
    pageviews_24h           BIGINT       NOT NULL DEFAULT 0,
    pageviews_7d            BIGINT       NOT NULL DEFAULT 0,
    unique_visitors         BIGINT       NOT NULL DEFAULT 0,
    avg_time_on_page_sec    NUMERIC(10,2),
    scroll_completion_rate  NUMERIC(5,2),
    read_completion_rate    NUMERIC(5,2),
    trending_score          NUMERIC(12,4) NOT NULL DEFAULT 0,
    source_breakdown        JSONB        NOT NULL DEFAULT '{}'::jsonb,
    scroll_funnel           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (site, article_id)
);
CREATE INDEX IF NOT EXISTS idx_article_stats_author   ON article_stats (author, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_stats_category ON article_stats (category_root, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_article_stats_trending ON article_stats (site, trending_score DESC);
CREATE INDEX IF NOT EXISTS idx_article_stats_24h      ON article_stats (site, pageviews_24h DESC);
CREATE INDEX IF NOT EXISTS idx_article_stats_tags     ON article_stats USING GIN (tags);

CREATE TABLE IF NOT EXISTS source_stats (
    site                VARCHAR(4)   NOT NULL,
    traffic_source      VARCHAR(40)  NOT NULL,
    category_root       VARCHAR(80)  NOT NULL,
    period_type         VARCHAR(10)  NOT NULL,
    period_start        DATE         NOT NULL,
    pageviews           BIGINT       NOT NULL DEFAULT 0,
    unique_visitors     BIGINT       NOT NULL DEFAULT 0,
    sessions            BIGINT       NOT NULL DEFAULT 0,
    avg_session_pages   NUMERIC(6,2),
    bounce_rate         NUMERIC(5,2),
    avg_session_sec     NUMERIC(10,2),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (site, traffic_source, category_root, period_type, period_start)
);
CREATE INDEX IF NOT EXISTS idx_source_stats_period
    ON source_stats (period_type, period_start DESC, pageviews DESC);

CREATE TABLE IF NOT EXISTS source_device_stats (
    site            VARCHAR(4)  NOT NULL,
    traffic_source  VARCHAR(40) NOT NULL,
    device_type     VARCHAR(20) NOT NULL,
    period_type     VARCHAR(10) NOT NULL,
    period_start    DATE        NOT NULL,
    pageviews       BIGINT      NOT NULL DEFAULT 0,
    unique_visitors BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site, traffic_source, device_type, period_type, period_start)
);

CREATE TABLE IF NOT EXISTS campaign_stats (
    site            VARCHAR(4)   NOT NULL,
    utm_source      VARCHAR(120) NOT NULL,
    utm_medium      VARCHAR(120) NOT NULL,
    utm_campaign    VARCHAR(255) NOT NULL,
    period_type     VARCHAR(10)  NOT NULL,
    period_start    DATE         NOT NULL,
    pageviews       BIGINT       NOT NULL DEFAULT 0,
    sessions        BIGINT       NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (site, utm_source, utm_medium, utm_campaign, period_type, period_start)
);

-- Satni vremenski niz za grafike (danas vs isti dan prosle nedelje)
CREATE TABLE IF NOT EXISTS hourly_traffic (
    site            VARCHAR(4)  NOT NULL,
    hour_utc        TIMESTAMPTZ NOT NULL,
    category_root   VARCHAR(80) NOT NULL DEFAULT '',
    pageviews       BIGINT      NOT NULL DEFAULT 0,
    sessions        BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (site, hour_utc, category_root)
);
CREATE INDEX IF NOT EXISTS idx_hourly_traffic_time ON hourly_traffic (hour_utc DESC);

-- ---------------------------------------------------------------------------
-- Auth i uloge (sekcija 11)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(200) UNIQUE NOT NULL,
    name            VARCHAR(200),
    password_hash   TEXT         NOT NULL,
    role            VARCHAR(20)  NOT NULL CHECK (role IN ('admin', 'editor', 'author')),
    author_slug     VARCHAR(120),
    sites           TEXT[]       NOT NULL DEFAULT '{rs}',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT author_needs_slug CHECK (role <> 'author' OR author_slug IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);

-- ---------------------------------------------------------------------------
-- A/B testiranje naslova (sekcija 8)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ab_tests (
    id                  BIGSERIAL PRIMARY KEY,
    test_id             VARCHAR(64) UNIQUE NOT NULL,
    site                VARCHAR(4)   NOT NULL,
    article_id          VARCHAR(40)  NOT NULL,
    status              VARCHAR(20)  NOT NULL DEFAULT 'running'
                        CHECK (status IN ('draft', 'running', 'stopped', 'completed')),
    winner_variant      VARCHAR(32),
    auto_promote        BOOLEAN      NOT NULL DEFAULT false,
    min_impressions     INT          NOT NULL DEFAULT 1000,
    confidence_target   NUMERIC(4,3) NOT NULL DEFAULT 0.95,
    created_by          BIGINT REFERENCES users(id),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ab_tests_article ON ab_tests (site, article_id, status);

CREATE TABLE IF NOT EXISTS ab_variants (
    id          BIGSERIAL PRIMARY KEY,
    test_id     VARCHAR(64) NOT NULL REFERENCES ab_tests(test_id) ON DELETE CASCADE,
    variant     VARCHAR(32) NOT NULL,
    headline    TEXT        NOT NULL,
    weight      INT         NOT NULL DEFAULT 1,
    is_control  BOOLEAN     NOT NULL DEFAULT false,
    UNIQUE (test_id, variant)
);

CREATE TABLE IF NOT EXISTS ab_results (
    test_id         VARCHAR(64) NOT NULL REFERENCES ab_tests(test_id) ON DELETE CASCADE,
    variant         VARCHAR(32) NOT NULL,
    impressions     BIGINT      NOT NULL DEFAULT 0,
    clicks          BIGINT      NOT NULL DEFAULT 0,
    ctr             NUMERIC(7,4),
    p_value         NUMERIC(10,8),
    confidence      NUMERIC(6,4),
    is_significant  BOOLEAN     NOT NULL DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (test_id, variant)
);

-- ---------------------------------------------------------------------------
-- Spike alerti (sekcija 9.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spike_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    site                VARCHAR(4)   NOT NULL,
    detected_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    minute_utc          TIMESTAMPTZ  NOT NULL,
    pageviews_per_min   BIGINT       NOT NULL,
    baseline_per_min    NUMERIC(12,2) NOT NULL,
    multiplier          NUMERIC(8,2) NOT NULL,
    driver_type         VARCHAR(20)  NOT NULL,
    driver_value        TEXT         NOT NULL,
    driver_pageviews    BIGINT       NOT NULL DEFAULT 0,
    notified            BOOLEAN      NOT NULL DEFAULT false,
    resolved_at         TIMESTAMPTZ,
    UNIQUE (site, minute_utc)
);
CREATE INDEX IF NOT EXISTS idx_spike_recent ON spike_alerts (detected_at DESC);

-- ---------------------------------------------------------------------------
-- Zakazani izvestaji (sekcija 10.7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id              BIGSERIAL PRIMARY KEY,
    user_id         BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    report_type     VARCHAR(30)  NOT NULL CHECK (report_type IN ('weekly', 'monthly')),
    scope           VARCHAR(30)  NOT NULL DEFAULT 'overview',
    site            VARCHAR(4)   NOT NULL DEFAULT 'rs',
    recipients      TEXT[]       NOT NULL DEFAULT '{}',
    is_active       BOOLEAN      NOT NULL DEFAULT true,
    last_sent_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Operativno: stanje cron poslova + backfill (sekcija 14, faza 3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_runs (
    id              BIGSERIAL PRIMARY KEY,
    job_name        VARCHAR(60)  NOT NULL,
    window_start    TIMESTAMPTZ,
    window_end      TIMESTAMPTZ,
    status          VARCHAR(20)  NOT NULL CHECK (status IN ('running', 'success', 'failed')),
    rows_written    BIGINT       NOT NULL DEFAULT 0,
    error           TEXT,
    started_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_job_runs_name ON job_runs (job_name, started_at DESC);

-- Vodozig do kog je datuma agregacija stigla; backfill cita odavde
CREATE TABLE IF NOT EXISTS job_watermarks (
    job_name        VARCHAR(60) PRIMARY KEY,
    watermark       TIMESTAMPTZ NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GDPR brisanja (sekcija 12.4) - revizioni trag
CREATE TABLE IF NOT EXISTS gdpr_deletions (
    id              BIGSERIAL PRIMARY KEY,
    visitor_id      VARCHAR(64) NOT NULL,
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    rows_affected   BIGINT,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
);
