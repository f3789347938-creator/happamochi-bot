-- Generalized push-free broadcast queue.
-- Any feature that used to require the LINE Push API (which has a monthly
-- free quota) instead inserts rows here. The next time ANY member sends a
-- message in that group, the webhook handler drains this queue and attaches
-- the pending notifications to the FREE Reply API call for that incoming
-- message (LINE allows up to 5 messages per reply call).
CREATE TABLE IF NOT EXISTS pending_broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  kind TEXT NOT NULL,             -- 'unsend' | 'birthday' | 'fortune' | 'ranking' | 'custom'
  message_json TEXT NOT NULL,     -- JSON array of LINE message objects
  dedup_key TEXT UNIQUE,          -- prevents duplicate inserts for the same event
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  delivered INTEGER DEFAULT 0,
  delivered_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_pending_broadcasts_group
  ON pending_broadcasts(group_id, delivered);
