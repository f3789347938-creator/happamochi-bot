-- 「めんかく」用: 自分宛のメンションを記録する。
--
-- LINEはWebhookの text メッセージに mention.mentionees[] を載せてくるので、
-- 「誰が誰をメンションしたか」はそこから取れる(2021年1月追加のプロパティ)。
-- ただし過去分は遡れないため、この記録を始めた時点以降しか出せない。
--
-- 引用(リプライ)表示に使う quoteToken も一緒に保存する。quoteToken は
-- 無期限・再利用可で、送られたトーク内でのみ使える(公式仕様)。
--
-- 方針どおり「追加のみ」。既存テーブルには一切手を入れない。
CREATE TABLE IF NOT EXISTS mentions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- メンションされた人(この人が「めんかく」で引く)
  target_id     TEXT NOT NULL,
  group_id      TEXT NOT NULL,
  -- メンションした人
  sender_id     TEXT NOT NULL,
  sender_name   TEXT,
  -- メンション元メッセージの本文と、引用表示用トークン
  message_id    TEXT NOT NULL,
  message_text  TEXT,
  quote_token   TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- 同じメッセージで同じ人を2回メンションしても1件にする
  UNIQUE(message_id, target_id)
);

-- 「自分宛の直近N件」を引くための索引。
CREATE INDEX IF NOT EXISTS idx_mentions_target
  ON mentions(target_id, group_id, created_at DESC);

-- 保持期間(7日)を過ぎた分を消すための索引。
CREATE INDEX IF NOT EXISTS idx_mentions_created
  ON mentions(created_at);
