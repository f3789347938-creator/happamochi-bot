-- お知らせの「グループごとに1回だけ自動送信」を管理するテーブル。
--
-- ANNOUNCEMENTS 配列に新しい id を追加すると、その id については各グループ
-- 未送信の状態になるため、次にそのグループで発言があったタイミングで
-- 1回だけ自動送信される。送信済みの id は二度と送らない。
-- (週間ランキングの weekly_ranking_sends と同じ考え方)
--
-- 方針どおり追加のみ。既存テーブルには一切触れない。
CREATE TABLE IF NOT EXISTS announcement_sends (
  group_id        TEXT NOT NULL,
  announcement_id TEXT NOT NULL,
  sent_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, announcement_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_sends_group
  ON announcement_sends(group_id);
