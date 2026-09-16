-- もち軍団サバイバル(引き継ぎパック v14)用のテーブル。
--
-- 方針:
--   * 既存テーブルには一切触れない。ここで作るのは追加の2つだけ。
--   * すべて CREATE TABLE IF NOT EXISTS。再実行しても壊れない。
--   * drizzle-orm は使わず素のSQLにする(依存を増やさないため)。
--   * 元パックの players / runs は名前が一般的すぎて衝突しやすいので
--     survivor_ 接頭辞を付ける。
--
-- user_id は LINE の userId。もち合体パズル(mochi_scores)と同じ値が入る。

CREATE TABLE IF NOT EXISTS survivor_players (
  user_id           TEXT PRIMARY KEY,
  display_name      TEXT,
  picture_url       TEXT,
  -- 見た目(実績で解放される)
  title             TEXT NOT NULL DEFAULT '',
  outfit            TEXT NOT NULL DEFAULT 'default',
  effect            TEXT NOT NULL DEFAULT 'default',
  -- 自己ベスト系(finish時に再集計して入れ直す)
  best_score        INTEGER NOT NULL DEFAULT 0,
  best_seconds      REAL    NOT NULL DEFAULT 0,
  clean_bosses      INTEGER NOT NULL DEFAULT 0,
  max_attack_kills  INTEGER NOT NULL DEFAULT 0,
  -- 累計系
  boss_kills        INTEGER NOT NULL DEFAULT 0,
  treasures         INTEGER NOT NULL DEFAULT 0,
  commanders        INTEGER NOT NULL DEFAULT 0,
  traps             INTEGER NOT NULL DEFAULT 0,
  plays             INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_survivor_players_best
  ON survivor_players(best_score DESC);

CREATE TABLE IF NOT EXISTS survivor_runs (
  id                TEXT PRIMARY KEY,
  owner             TEXT NOT NULL,
  mode              TEXT NOT NULL,
  week              TEXT NOT NULL,
  ruleset           TEXT NOT NULL,
  weapon            TEXT NOT NULL,
  seed              INTEGER NOT NULL,
  started_at        INTEGER NOT NULL,
  finished_at       INTEGER,
  score             INTEGER NOT NULL DEFAULT 0,
  seconds           REAL    NOT NULL DEFAULT 0,
  kills             INTEGER NOT NULL DEFAULT 0,
  boss_kills        INTEGER NOT NULL DEFAULT 0,
  clean_bosses      INTEGER NOT NULL DEFAULT 0,
  max_attack_kills  INTEGER NOT NULL DEFAULT 0,
  treasures         INTEGER NOT NULL DEFAULT 0,
  commanders        INTEGER NOT NULL DEFAULT 0,
  traps             INTEGER NOT NULL DEFAULT 0,
  report            TEXT
);

CREATE INDEX IF NOT EXISTS idx_survivor_runs_owner
  ON survivor_runs(owner, finished_at);

CREATE INDEX IF NOT EXISTS idx_survivor_runs_board
  ON survivor_runs(ruleset, mode, week, score DESC);

-- 同時に進行中の出撃は1人1つまで。二重計上を防ぐ。
CREATE UNIQUE INDEX IF NOT EXISTS idx_survivor_runs_one_active
  ON survivor_runs(owner) WHERE finished_at IS NULL;
