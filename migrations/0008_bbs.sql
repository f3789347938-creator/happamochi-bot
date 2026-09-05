-- LINE group recruitment bulletin board ("LINEグループ募集掲示板") + open chat.
-- These tables ALREADY EXIST in the live production DB (line-group-bbs-db)
-- with real historical data (40 threads rows, 35 chat_messages rows, dating
-- back to 2025-11-09). Definitions here are IF NOT EXISTS and match the
-- production schema exactly (confirmed via schema dump of the production
-- backup), so this migration is a no-op against prod and only creates the
-- tables fresh in local/dev DBs so the rebuilt BBS feature can be tested
-- there too.
--
-- NOTE: historical row content includes literal unescaped XSS payloads
-- (e.g. thread title `<script>alert('XSS injection!!!');</script>`) —
-- proof the original site failed to escape output. The DATA itself is left
-- untouched (never destroy data), but every place that RENDERS these
-- fields as HTML (src/features/bbs.ts) MUST escape them.

CREATE TABLE IF NOT EXISTS "threads" (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  likes INTEGER DEFAULT 0,
  views INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  image_url TEXT,
  qr_code_url TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Seed the open chat with the original welcome message only if the table is
-- completely empty (keeps prod's existing 35 rows intact; gives a fresh
-- local/dev DB something to render immediately).
INSERT INTO chat_messages (id, content, author, created_at)
SELECT '1', 'オープンチャットへようこそ！🎉 誰でも自由に会話できます。', 'システム', '2025-11-09T10:00:00.000Z'
WHERE NOT EXISTS (SELECT 1 FROM chat_messages);
