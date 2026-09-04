-- Othello (Reversi) game state, one active game per group.
-- board is stored as a 64-char string, row-major (index = row*8+col),
-- where '.' = empty, 'B' = black, 'W' = white.
CREATE TABLE IF NOT EXISTS othello_games (
  group_id TEXT PRIMARY KEY,
  board TEXT NOT NULL,
  turn TEXT NOT NULL CHECK (turn IN ('B', 'W')),
  black_user_id TEXT NOT NULL,
  black_name TEXT,
  white_user_id TEXT,
  white_name TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'playing', 'finished')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
