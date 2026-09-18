-- Ranking icons are independent of status costumes. No backfill: every
-- existing and new user keeps their LINE profile image until they choose one.
CREATE TABLE IF NOT EXISTS ranking_icons (
  user_id TEXT PRIMARY KEY REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  costume_id TEXT REFERENCES dressup_catalog(item_id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (costume_id IS NULL OR costume_id GLOB 'C[0-9][0-9][0-9]')
);
