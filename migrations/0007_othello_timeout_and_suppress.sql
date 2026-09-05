-- Adds support for:
-- 1) 5-minute inactivity timeout on an in-progress ("playing") game, checked
--    lazily whenever any message arrives in the group (no cron / push).
-- 2) Per-user, per-turn suppression of repeated rejection replies (e.g.
--    "相手の番です。" / "この対局の参加者ではありません。") when someone taps
--    a cell they can't legally act on multiple times within 5 seconds.
--
-- Additive only (ALTER TABLE ADD COLUMN) — no existing data is touched.
ALTER TABLE othello_games ADD COLUMN last_move_at DATETIME;
ALTER TABLE othello_games ADD COLUMN last_reject_user_id TEXT;
ALTER TABLE othello_games ADD COLUMN last_reject_at DATETIME;

-- Backfill last_move_at from updated_at for any existing rows so the
-- 5-minute timeout has a sane starting point instead of NULL.
UPDATE othello_games SET last_move_at = updated_at WHERE last_move_at IS NULL;
