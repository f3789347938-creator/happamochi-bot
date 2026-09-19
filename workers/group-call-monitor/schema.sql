CREATE TABLE IF NOT EXISTS oa_call_monitor_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  initialized_at INTEGER NOT NULL,
  scope_key TEXT NOT NULL DEFAULT '',
  scope_activated_at INTEGER NOT NULL DEFAULT 0,
  cursor TEXT NOT NULL DEFAULT '',
  discovery_next TEXT NOT NULL DEFAULT '',
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  last_success_at INTEGER,
  last_event_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS oa_call_notifications (
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  detected_at INTEGER NOT NULL,
  message_text TEXT NOT NULL,
  send_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','sending','sent','uncertain','failed','observed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  sent_at INTEGER,
  error_code TEXT,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS oa_call_notifications_pending ON oa_call_notifications(status, detected_at);
CREATE UNIQUE INDEX IF NOT EXISTS oa_call_notifications_send_id ON oa_call_notifications(chat_id, send_id);

CREATE TABLE IF NOT EXISTS oa_call_chat_cursors (
  chat_id TEXT PRIMARY KEY,
  checked_through INTEGER NOT NULL DEFAULT 0,
  needs_scan INTEGER NOT NULL DEFAULT 1,
  history_backward TEXT NOT NULL DEFAULT '',
  scan_cutoff INTEGER NOT NULL DEFAULT 0,
  scan_through INTEGER NOT NULL DEFAULT 0,
  last_scan_at INTEGER NOT NULL DEFAULT 0
);
