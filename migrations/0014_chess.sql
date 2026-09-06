-- チェス対局。既存テーブルには一切触れず、追加のみ。
--
-- 【1グループ1件の制約】
-- 「募集中(waiting)または対局中(playing)は1グループ1件」を
-- 部分UNIQUEインデックスで担保する。終局(finished/aborted)は
-- 履歴として複数残せる。
CREATE TABLE IF NOT EXISTS chess_games (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'waiting'
                      CHECK (status IN ('waiting','playing','finished','aborted')),

  -- 参加者。waiting中は creator のみ入り、成立時に white/black が確定する。
  creator_user_id   TEXT NOT NULL,
  white_user_id     TEXT,
  black_user_id     TEXT,
  -- 表示用の名前/アイコン。取得失敗時はNULLで、描画側が代替表示にする。
  white_name        TEXT,
  black_name        TEXT,
  white_picture     TEXT,
  black_picture     TEXT,

  -- 局面。start_fen から moves_json を順に適用すると current_fen になる。
  -- 繰り返し判定(同一局面3回)には履歴が必要なので、FENだけでなく
  -- 全指し手(moves_json)も保存し、復元時は履歴ごと再生する。
  start_fen         TEXT NOT NULL,
  current_fen       TEXT NOT NULL,
  moves_json        TEXT NOT NULL DEFAULT '[]',   -- SAN文字列の配列
  pgn               TEXT NOT NULL DEFAULT '',
  turn              TEXT NOT NULL DEFAULT 'w' CHECK (turn IN ('w','b')),

  -- 楽観ロック用。指し手が確定するたびに +1。
  -- 古いカードから押された操作は version 不一致で弾く。
  version           INTEGER NOT NULL DEFAULT 0,

  -- 未確定の選択状態(駒を選んだだけの状態)。指し手確定で必ずクリアする。
  sel_square        TEXT,        -- 例 'e2'
  sel_token         TEXT,        -- 選択ごとに変わる識別子。古い移動先を弾く

  -- 昇格待ち。ここが埋まっている間は手番を進めない。
  pending_from      TEXT,
  pending_to        TEXT,
  pending_token     TEXT,

  -- 引き分け提案。提案者と有効期限。指し手確定で失効させる。
  draw_by           TEXT,
  draw_expires_at   TEXT,

  -- 投了確認(本人専用の2段確認)
  resign_by         TEXT,
  resign_token      TEXT,
  resign_expires_at TEXT,

  -- 募集期限(waiting のみ)。再起動後も維持されるようDBに持つ。
  expires_at        TEXT,

  -- 結果
  result            TEXT,        -- 'white','black','draw','aborted'
  result_reason     TEXT,

  -- 再戦提案
  rematch_by        TEXT,
  rematch_expires_at TEXT,
  rematch_child_id  TEXT,        -- 作成済みの再戦対局。連打での重複作成を防ぐ

  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同一グループで waiting/playing が同時に2件以上存在しないようにする
CREATE UNIQUE INDEX IF NOT EXISTS uq_chess_active_per_group
  ON chess_games(group_id)
  WHERE status IN ('waiting','playing');

CREATE INDEX IF NOT EXISTS idx_chess_group_status ON chess_games(group_id, status);
CREATE INDEX IF NOT EXISTS idx_chess_updated ON chess_games(updated_at);

-- Webhookイベントの重複処理を防ぐ。LINEは再送することがあるため、
-- webhookEventId を一意制約にして「同じ指し手が2回確定する」のを防ぐ。
CREATE TABLE IF NOT EXISTS chess_processed_events (
  event_id    TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 送信待ち/送信結果。DB更新とLINE送信を分離し、送信失敗で
-- 確定済みの指し手を巻き戻さないための記録。
CREATE TABLE IF NOT EXISTS chess_outbox (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     TEXT NOT NULL,
  group_id    TEXT NOT NULL,
  payload     TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending','sent','failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_chess_outbox_state ON chess_outbox(state, id);
