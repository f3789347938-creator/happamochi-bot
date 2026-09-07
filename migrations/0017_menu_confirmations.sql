-- ヘルプメニュー(hmhelp)の確認意図を保存する。
--
-- なぜサーバーに保存するか:
--   仕様の confirmation_binding に従い、「この内容で変更する」という確認は
--   postback の文字列を信用して実行してはいけない。押した人・グループ・操作・
--   期限をサーバー側に保存し、確定時に受信イベントの実体と一致するか照合する。
--   これにより、
--     ・他人が他人の確認ボタンを押しても実行されない
--     ・古い確認カードのボタンを押しても実行されない(期限切れ)
--     ・postback を書き換えても保存された操作しか実行されない
--   を満たす。
--
-- 追加のみ。既存テーブルには一切触らない。
CREATE TABLE IF NOT EXISTS menu_confirmations (
  -- サーバー発行の短い識別子。postback にはこの id だけを載せる。
  id TEXT PRIMARY KEY,
  -- 確認を作った本人(Webhookの source.userId)。確定時に必ず照合する。
  user_id TEXT NOT NULL,
  -- グループ設定の操作なら、そのグループ。個人操作は NULL。
  group_id TEXT,
  -- 実行する操作の種類。サーバー側の許可リストに載っているものだけ。
  op TEXT NOT NULL,
  -- 操作の引数(ウェルカム本文など)。無い操作は NULL。
  payload TEXT,
  -- 使用済みフラグ。二重実行を防ぐ。
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  -- 期限(UNIX秒)。過ぎた確認は実行せず、案内を出し直す。
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_menu_confirmations_user
  ON menu_confirmations(user_id, used);
