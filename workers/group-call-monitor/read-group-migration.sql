-- Apply before deploying the shared-session code. The legacy table is preserved.
CREATE TABLE IF NOT EXISTS oa_read_group_sessions (
  chat_id TEXT NOT NULL PRIMARY KEY,
  set_by_user_id TEXT NOT NULL,
  checkpoint_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oa_read_group_sessions_expiry ON oa_read_group_sessions(expires_at);
CREATE TABLE IF NOT EXISTS oa_read_migrations (
  migration_id TEXT NOT NULL PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS oa_read_commands_group_event ON oa_read_commands(chat_id, event_at);

INSERT OR IGNORE INTO oa_read_group_sessions(chat_id,set_by_user_id,checkpoint_at,started_at,expires_at)
SELECT chat_id,owner_user_id,checkpoint_at,started_at,expires_at FROM (
  SELECT *,row_number() OVER (
    PARTITION BY chat_id ORDER BY checkpoint_at DESC,started_at DESC,owner_user_id ASC
  ) AS session_order FROM oa_read_sessions
)
WHERE session_order=1 AND NOT EXISTS (
  SELECT 1 FROM oa_read_migrations WHERE migration_id='shared_group_sessions_v1'
);

-- This marker prevents a later rerun from reviving a group that was stopped.
INSERT OR IGNORE INTO oa_read_migrations(migration_id,applied_at)
VALUES ('shared_group_sessions_v1',CAST(strftime('%s','now') AS INTEGER)*1000);
