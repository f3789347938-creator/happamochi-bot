-- Circle Boardデザイン統合: 利用ガイドページの「通報・お問い合わせ」フォーム用テーブル。
-- 既存テーブルには一切影響を与えない、追加のみのマイグレーション。
CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at);
