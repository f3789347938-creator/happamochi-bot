-- Every call to LINE's Reply API is logged here (success or failure),
-- so we can look at the DB after a real LINE test and know for certain
-- whether the bot actually tried to reply, and what LINE said back.
CREATE TABLE IF NOT EXISTS reply_api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT,
  reply_token TEXT,
  status_code INTEGER,
  ok INTEGER,
  response_body TEXT,
  message_preview TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_reply_api_logs_created ON reply_api_logs(created_at);
