-- もち合体パズル(LIFFミニゲーム)のスコアランキング。
--
-- 既存データは一切壊さない。新しいテーブルを1つ足すだけ。
--
-- 設計の要点:
--   ・user_id は「LINEログインチャネル『葉っぱ』の userId」。
--     Botの Messaging API チャネルの userId とは別物になる可能性があるため、
--     既存の user_profiles とは結合しない(独立したランキングとして扱う)。
--   ・クライアントから送られてきた userId は絶対に信用しない。
--     サーバーが LINE の verify + profile API でアクセストークンを検証し、
--     そこから得た userId だけを書き込む(なりすまし防止)。
--   ・1人1行。自己ベストのみ保持する(履歴は持たない)。
--     ランキング表示に必要なのは最高記録だけで、行数が増え続けないため。
CREATE TABLE IF NOT EXISTS mochi_scores (
  user_id      TEXT PRIMARY KEY,
  display_name TEXT,
  picture_url  TEXT,
  best_score   INTEGER NOT NULL DEFAULT 0,
  best_merges  INTEGER NOT NULL DEFAULT 0,
  best_stage   INTEGER NOT NULL DEFAULT 0,
  plays        INTEGER NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ランキングは best_score の降順で読む。
CREATE INDEX IF NOT EXISTS idx_mochi_scores_best ON mochi_scores(best_score DESC);
