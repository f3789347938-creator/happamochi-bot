-- 「りぷかく」用: 自分の発言に対するリプライ(引用返信)を記録する。
--
-- 「めんかく」(mentions)との違い:
--   ・めんかく = @メンションされた   → message.mention.mentionees[]
--   ・りぷかく = 自分の発言に返信された → message.quotedMessageId
--
-- quotedMessageId は「返信元(=引用された元メッセージ)のID」なので、
-- それを group_messages から引いて「元の発言者 = 返信された人」を特定する。
-- この仕組みは既に「めいく」で使われているものと同じ。
--
-- 引用表示に使う quote_token は、返信そのもののメッセージのトークン。
-- (元の発言ではなく、返信を引用して見せたいため)
--
-- 方針どおり「追加のみ」。既存テーブルには一切手を入れない。
CREATE TABLE IF NOT EXISTS replies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- リプライされた人(元の発言者。この人が「りぷかく」で引く)
  target_id     TEXT NOT NULL,
  group_id      TEXT NOT NULL,
  -- リプライした人
  sender_id     TEXT NOT NULL,
  sender_name   TEXT,
  -- リプライ側のメッセージ情報
  message_id    TEXT NOT NULL,
  message_text  TEXT,
  quote_token   TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, target_id)
);

-- 「自分宛の直近N件」を引くための索引。
CREATE INDEX IF NOT EXISTS idx_replies_target
  ON replies(target_id, group_id, created_at DESC);

-- 保持期間(7日)を過ぎた分を消すための索引。
CREATE INDEX IF NOT EXISTS idx_replies_created
  ON replies(created_at);
