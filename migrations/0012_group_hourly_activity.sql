-- グループ発言数ランキング用の時間帯別集計テーブル。
--
-- 既存の group_activities は (group_id, user_id, activity_date) 単位で
-- 日別カウントしか持っておらず、「主な活動時間帯」を出すのに必要な
-- 時刻情報が存在しない。過去分は復元できないため、このテーブルは
-- 新規に積み上げていく(集計開始日以降のみ表示する)。
--
-- 方針どおり追加のみ。既存テーブルには一切触れない。
CREATE TABLE IF NOT EXISTS group_hourly_activity (
  group_id      TEXT    NOT NULL,
  activity_date DATE    NOT NULL,  -- JSTの日付 (YYYY-MM-DD)
  hour_jst      INTEGER NOT NULL,  -- JSTの時 (0-23)
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, activity_date, hour_jst)
);

CREATE INDEX IF NOT EXISTS idx_group_hourly_date
  ON group_hourly_activity(activity_date);
CREATE INDEX IF NOT EXISTS idx_group_hourly_group_date
  ON group_hourly_activity(group_id, activity_date);

-- ランキング一覧・日別グラフを高速化するための、既存テーブルへの
-- インデックス追加(テーブル構造そのものは変更しない)。
CREATE INDEX IF NOT EXISTS idx_group_activities_date
  ON group_activities(activity_date);
CREATE INDEX IF NOT EXISTS idx_group_activities_group_date
  ON group_activities(group_id, activity_date);
