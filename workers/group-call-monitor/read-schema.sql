CREATE TABLE IF NOT EXISTS oa_read_sessions (
  chat_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  checkpoint_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, owner_user_id)
);
CREATE INDEX IF NOT EXISTS oa_read_sessions_expiry ON oa_read_sessions(expires_at);

-- Retain the legacy per-owner table above for a non-destructive rollout.
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

CREATE TABLE IF NOT EXISTS oa_read_receipts (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  watermark INTEGER NOT NULL,
  event_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS oa_read_commands (
  chat_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('start', 'stop', 'list')),
  event_at INTEGER NOT NULL,
  message_text TEXT NOT NULL DEFAULT '',
  send_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'sending', 'sent', 'uncertain', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_attempt_at INTEGER,
  sent_at INTEGER,
  error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, event_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS oa_read_commands_send_id ON oa_read_commands(chat_id, send_id);
CREATE INDEX IF NOT EXISTS oa_read_commands_expiry ON oa_read_commands(created_at);
CREATE INDEX IF NOT EXISTS oa_read_commands_interrupted ON oa_read_commands(status, updated_at);
CREATE INDEX IF NOT EXISTS oa_read_commands_group_event ON oa_read_commands(chat_id, event_at);
