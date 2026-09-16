-- 連呼対策(C案): 直前と同じ本文の発言では EXP/ポイントを加算しない。
--
-- 判定に「その人が直前に加算対象として送った本文」が必要だが、既存の
-- テーブルにはそれが無い(group_messages はグループのみ・個人トークが
-- 入らない/他人の発言も混ざるため、人単位の直前判定には使えない)。
-- そこで人単位の直前本文だけを持つ小さなテーブルを新設する。
--
-- 方針どおり「追加のみ」。既存テーブルには一切手を入れない。
CREATE TABLE IF NOT EXISTS exp_last_message (
  user_id    TEXT PRIMARY KEY,
  -- 直前に EXP を加算したときの本文。
  -- テキスト以外(スタンプ/画像など)は本文が無いので比較対象にせず、
  -- その場合はこの値を NULL に戻して「連続扱いしない」ようにする。
  last_text  TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
