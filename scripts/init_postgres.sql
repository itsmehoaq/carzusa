-- Run only against the carzusa database, after creating carzusa_app as its owner.
\set ON_ERROR_STOP on
SELECT current_database() = 'carzusa' AS is_carzusa \gset
\if :is_carzusa
BEGIN;
CREATE TABLE IF NOT EXISTS twitter_reposts (
  id BIGSERIAL PRIMARY KEY,
  guild_id VARCHAR(32) NOT NULL,
  tweet_key TEXT NOT NULL,
  first_user_id VARCHAR(32) NOT NULL,
  first_channel_id VARCHAR(32),
  first_message_id VARCHAR(32),
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_twitter_reposts_guild_tweet UNIQUE (guild_id, tweet_key)
);
CREATE TABLE IF NOT EXISTS osu_users (
  id BIGSERIAL PRIMARY KEY,
  discord_id VARCHAR(32) NOT NULL UNIQUE,
  osu_id BIGINT,
  osu_username VARCHAR(64),
  default_mode VARCHAR(16) NOT NULL DEFAULT 'osu',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE twitter_reposts OWNER TO carzusa_app;
ALTER SEQUENCE twitter_reposts_id_seq OWNER TO carzusa_app;
ALTER TABLE osu_users OWNER TO carzusa_app;
ALTER SEQUENCE osu_users_id_seq OWNER TO carzusa_app;
CREATE INDEX IF NOT EXISTS idx_twitter_reposts_lookup ON twitter_reposts (guild_id, tweet_key);
COMMIT;
\else
\echo 'Refusing to initialize a database other than carzusa'
\quit 1
\endif
