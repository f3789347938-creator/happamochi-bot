-- BBS機能拡張: コメント(返信)機能・投稿ペース制限用の軽量ログ。
-- 既存の threads / chat_messages テーブルは一切変更しない(データ破壊禁止の方針)。
-- 追加のみ・すべて CREATE TABLE IF NOT EXISTS で記述。

-- スレッドへのコメント(返信)。既存 threads テーブルとは別テーブルにして、
-- 既存の40件のスレッドデータには一切触れない。
CREATE TABLE IF NOT EXISTS thread_comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_thread_comments_thread_id ON thread_comments(thread_id);

-- 簡易スパム対策: 直近の投稿時刻をIPハッシュ単位で記録し、短時間の連続投稿を防ぐ。
-- (Cloudflare Pages/Workersにメモリ状態を持たせられないため、D1に記録して判定する)
CREATE TABLE IF NOT EXISTS post_rate_limits (
  client_key TEXT PRIMARY KEY,
  last_posted_at TEXT NOT NULL,
  post_count INTEGER NOT NULL DEFAULT 1
);
