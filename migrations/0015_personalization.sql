-- 個人ステータス(レベル/EXP/ポイント)・カードテーマ・共通称号。
--
-- 方針:
--   ・すべて CREATE TABLE IF NOT EXISTS の追加のみ。既存テーブルは
--     一切変更しない(ALTER も DROP もしない)。
--   ・既存の title_master / user_titles(グループ別称号)は手を付けない。
--     新しい300種類の称号は common_title_master / user_common_titles として
--     完全に別管理にする。名前が同じでも自動統合しない。
--   ・既存の group_activities(個人別・UTC日付)、group_rankings、
--     weekly_ranking_sends の集計方法は変更しない。

-- === 個人プロフィール(人単位・全グループ共通) ===========================
-- 累計EXPを唯一の真実として保存し、レベルと「レベル内EXP」は
-- 累計から都度計算する(必要EXP = 100 + 8*(level-1))。
-- こうしておけば計算式を直したときも過去データが壊れない。
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        TEXT PRIMARY KEY,
  -- 公開ページ用のID。LINEのユーザーIDは絶対に公開しないため、
  -- 無関係なランダム値を別に持つ。
  public_id      TEXT NOT NULL UNIQUE,
  display_name   TEXT,
  picture_url    TEXT,
  -- 累計EXP。1通=1EXP。レベルは導出値。
  total_exp      INTEGER NOT NULL DEFAULT 0,
  -- 保有ポイント。EXPが1増えるとき同時に1増える。使うと減る。
  points         INTEGER NOT NULL DEFAULT 0,
  -- 使用中のカードテーマ(theme_master.id)。初期は無料の水色。
  active_theme   TEXT NOT NULL DEFAULT 'aqua',
  -- 装備中の共通称号(common_title_master.id)。未装備は NULL=「未設定」。
  equipped_title TEXT,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 個人ランキング(累計EXPの多い順)を引くための索引。
CREATE INDEX IF NOT EXISTS idx_user_profiles_exp ON user_profiles(total_exp DESC);

-- === EXP加算の重複防止 ===================================================
-- 「1通を正しく1回と数える」ためのもの。連呼対策ではない。
-- LINEのWebhook再送(同一 webhookEventId)や、同じ message.id の再受信で
-- 二重加算されるのを防ぐ。イベントIDが無い場合はメッセージIDを使う。
CREATE TABLE IF NOT EXISTS exp_events (
  event_key  TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- === カードテーマ =========================================================
CREATE TABLE IF NOT EXISTS theme_master (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- 0 なら無料の初期テーマ。
  price         INTEGER NOT NULL DEFAULT 0,
  header_bg     TEXT NOT NULL,
  body_bg       TEXT NOT NULL,
  text_color    TEXT NOT NULL,
  accent        TEXT NOT NULL,
  header_text   TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- 所持と使用中は別管理(購入しただけでは切り替えない)。
CREATE TABLE IF NOT EXISTS user_themes (
  user_id     TEXT NOT NULL,
  theme_id    TEXT NOT NULL,
  obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, theme_id)
);

-- ポイント履歴。二重引き落としの検出と調査のために残す。
-- reason_key に一意制約を付け、同じ購入操作が2回成立しないようにする。
CREATE TABLE IF NOT EXISTS point_ledger (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  reason_key TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- === 共通称号(300種類) ===================================================
-- 既存の title_master(グループ別)とは別物。混ぜない。
CREATE TABLE IF NOT EXISTS common_title_category (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS common_title_master (
  id            TEXT PRIMARY KEY,
  category      TEXT NOT NULL,
  name          TEXT NOT NULL,
  -- 検索・重複判定用の正規化名(NFKC・小文字化・前後空白除去)。
  -- 表示名(name)は書き換えない。
  name_norm     TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  -- 'free' | 'level' | 'othello_wins'
  unlock_type   TEXT NOT NULL,
  -- level のとき必要レベル、othello_wins のとき必要勝利数。free は NULL。
  unlock_value  INTEGER,
  unlock_label  TEXT NOT NULL,
  -- カタログ側の状態('free_choice' | 'proposal_requires_review')。
  -- proposal_requires_review は条件が提案値であることを示す。
  rule_status   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_common_title_cat ON common_title_master(category, display_order);
CREATE INDEX IF NOT EXISTS idx_common_title_norm ON common_title_master(name_norm);

-- 共通称号の所持。自由選択の称号は所持行を作らず「常に使える」扱いにし、
-- 条件付きの称号だけ解放時に行を作る(解放履歴として残す)。
-- 一度解放したものは、後で条件判定が変わっても没収しない。
CREATE TABLE IF NOT EXISTS user_common_titles (
  user_id     TEXT NOT NULL,
  title_id    TEXT NOT NULL,
  unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, title_id)
);

-- === 初期テーマ ===========================================================
-- 価格: 水色=無料 / ホワイト=300 / ブラック=500 / さくらピンク=700
INSERT OR IGNORE INTO theme_master
  (id, name, price, header_bg, body_bg, text_color, accent, header_text, display_order)
VALUES
  ('aqua',   '水色',       0,   '#009FDE', '#E4F7FF', '#17364C', '#16BCEC', '#FFFFFF', 1),
  ('white',  'ホワイト',   300, '#EEF3F7', '#FFFFFF', '#203747', '#6B879B', '#203747', 2),
  ('black',  'ブラック',   500, '#17212B', '#202C37', '#F5F9FD', '#7DD3FC', '#F5F9FD', 3),
  ('sakura', 'さくらピンク', 700, '#F6C9D6', '#FFF7FA', '#643A4E', '#C56B91', '#643A4E', 4);
