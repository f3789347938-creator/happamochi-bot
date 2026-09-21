-- Game rewards share one JST daily budget. Historical runs are deliberately
-- not backfilled: only sessions created after this migration can earn points.
CREATE TABLE IF NOT EXISTS game_reward_daily (
  user_id TEXT NOT NULL,
  reward_day TEXT NOT NULL,
  earned_points INTEGER NOT NULL DEFAULT 0 CHECK (earned_points BETWEEN 0 AND 1000),
  PRIMARY KEY (user_id, reward_day)
);

CREATE TABLE IF NOT EXISTS game_reward_runs (
  game TEXT NOT NULL CHECK (game IN ('puzzle', 'survivor')),
  run_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  finished_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0 CHECK (typeof(score) = 'integer' AND score >= 0),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 100),
  reward_day TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending', 'awarded', 'too_short', 'no_score', 'daily_limit', 'expired', 'superseded')),
  balance_after INTEGER,
  daily_earned_after INTEGER,
  PRIMARY KEY (game, run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_reward_one_active
  ON game_reward_runs(user_id, game) WHERE status = 'pending';

-- A single conditional UPDATE owns the receipt. SQLite serializes the trigger
-- with the daily budget, ledger and balance writes, including across games.
-- An error anywhere rolls the complete UPDATE back, leaving it retryable.
CREATE TRIGGER IF NOT EXISTS game_reward_settle
AFTER UPDATE OF finished_at ON game_reward_runs
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL
  AND OLD.status = 'pending' AND NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'game_reward_profile_missing')
    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id);
  INSERT OR IGNORE INTO game_reward_daily(user_id, reward_day, earned_points)
    VALUES(NEW.user_id, NEW.reward_day, 0);
  UPDATE game_reward_runs SET
    points = CASE
      WHEN NEW.finished_at > NEW.expires_at OR NEW.finished_at - NEW.started_at < 30000 THEN 0
      ELSE MIN(100, CAST(NEW.score / 100 AS INTEGER), MAX(0, 1000 - (
        SELECT earned_points FROM game_reward_daily
        WHERE user_id = NEW.user_id AND reward_day = NEW.reward_day))) END,
    status = CASE
      WHEN NEW.finished_at > NEW.expires_at THEN 'expired'
      WHEN NEW.finished_at - NEW.started_at < 30000 THEN 'too_short'
      WHEN NEW.score < 100 THEN 'no_score'
      WHEN (SELECT earned_points FROM game_reward_daily
        WHERE user_id = NEW.user_id AND reward_day = NEW.reward_day) >= 1000 THEN 'daily_limit'
      ELSE 'awarded' END
    WHERE game = NEW.game AND run_id = NEW.run_id;
  UPDATE user_profiles SET points = points + (
      SELECT points FROM game_reward_runs WHERE game = NEW.game AND run_id = NEW.run_id),
      updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id;
  INSERT INTO point_ledger(user_id, delta, reason, reason_key)
    SELECT user_id, points, 'game_' || game, 'game:' || game || ':' || run_id
    FROM game_reward_runs WHERE game = NEW.game AND run_id = NEW.run_id AND points > 0;
  UPDATE game_reward_daily SET earned_points = earned_points + (
      SELECT points FROM game_reward_runs WHERE game = NEW.game AND run_id = NEW.run_id)
    WHERE user_id = NEW.user_id AND reward_day = NEW.reward_day;
  UPDATE game_reward_runs SET
    balance_after = (SELECT points FROM user_profiles WHERE user_id = NEW.user_id),
    daily_earned_after = (SELECT earned_points FROM game_reward_daily
      WHERE user_id = NEW.user_id AND reward_day = NEW.reward_day)
    WHERE game = NEW.game AND run_id = NEW.run_id;
END;
