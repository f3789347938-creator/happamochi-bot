-- Othello (オセロ) win/loss/draw record persistence.
-- Previously endGame() just did `DELETE FROM othello_games` with zero
-- history kept anywhere. This adds a per-user, per-group record table so
-- "オセロ戦績" can report wins/losses/draws, and so a win can be the real
-- trigger for grantTitle() (Fix #1) instead of it having zero call sites.
CREATE TABLE IF NOT EXISTS othello_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

-- Title granted to a player the first time they reach 3 wins in a group
-- (decided trigger for grantTitle() — see src/features/othello.ts
-- recordResult()). Uses one of the 5 existing SSR titles already seeded
-- by migration 0003 so no new title_master row is needed.
