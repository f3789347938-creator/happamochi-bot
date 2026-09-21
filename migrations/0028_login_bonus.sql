-- One login bonus per LINE user per JST day, shared across groups and DMs.
-- Additive and repeatable: no existing profile, game reward or ledger is reset.
CREATE TABLE IF NOT EXISTS login_bonus_state (
  user_id TEXT PRIMARY KEY,
  last_day TEXT NOT NULL,
  total_days INTEGER NOT NULL CHECK (typeof(total_days) = 'integer' AND total_days >= 1),
  streak_days INTEGER NOT NULL CHECK (typeof(streak_days) = 'integer' AND streak_days BETWEEN 1 AND total_days)
);

CREATE TABLE IF NOT EXISTS login_bonus_claims (
  user_id TEXT NOT NULL,
  claim_day TEXT NOT NULL CHECK (claim_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  awarded_event_key TEXT NOT NULL CHECK (length(awarded_event_key) BETWEEN 1 AND 256),
  total_days INTEGER NOT NULL CHECK (typeof(total_days) = 'integer' AND total_days >= 1),
  streak_days INTEGER NOT NULL CHECK (typeof(streak_days) = 'integer' AND streak_days BETWEEN 1 AND total_days),
  reward_days INTEGER NOT NULL CHECK (reward_days = MIN(streak_days, 7)),
  reward_points INTEGER NOT NULL CHECK (reward_points = reward_days * 500),
  balance_after INTEGER NOT NULL CHECK (typeof(balance_after) = 'integer' AND balance_after >= reward_points),
  claimed_at INTEGER NOT NULL CHECK (typeof(claimed_at) = 'integer' AND claimed_at >= 0),
  PRIMARY KEY (user_id, claim_day),
  UNIQUE (user_id, awarded_event_key)
);

-- Remember even a second login command on the same day. Otherwise replaying
-- that previously non-awarding event after midnight could claim a new bonus.
CREATE TABLE IF NOT EXISTS login_bonus_events (
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 256),
  claim_day TEXT NOT NULL CHECK (claim_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  attempt_id TEXT NOT NULL,
  received_at INTEGER NOT NULL CHECK (typeof(received_at) = 'integer' AND received_at >= 0),
  PRIMARY KEY (user_id, event_key)
);

-- This trigger and its invoking event INSERT are one SQLite statement. A
-- ledger conflict or any other failure rolls back the event, award and balance.
CREATE TRIGGER IF NOT EXISTS login_bonus_credit
AFTER INSERT ON login_bonus_claims
BEGIN
  SELECT RAISE(ABORT, 'login_bonus_profile_missing')
    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id);
  UPDATE user_profiles SET points = points + NEW.reward_points, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id;
  INSERT INTO point_ledger(user_id, delta, reason, reason_key)
    VALUES(NEW.user_id, NEW.reward_points, 'login_bonus', 'login:' || NEW.user_id || ':' || NEW.claim_day);
  INSERT INTO login_bonus_state(user_id, last_day, total_days, streak_days)
    VALUES(NEW.user_id, NEW.claim_day, NEW.total_days, NEW.streak_days)
    ON CONFLICT(user_id) DO UPDATE SET last_day = excluded.last_day,
      total_days = excluded.total_days, streak_days = excluded.streak_days;
END;

CREATE TRIGGER IF NOT EXISTS login_bonus_record_event
AFTER INSERT ON login_bonus_events
BEGIN
  SELECT RAISE(ABORT, 'login_bonus_profile_missing')
    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id);
  -- A delayed invocation with an older server date must never rewind a streak.
  SELECT RAISE(ABORT, 'login_bonus_clock_reversed')
    WHERE EXISTS (SELECT 1 FROM login_bonus_state WHERE user_id = NEW.user_id AND last_day > NEW.claim_day);
  INSERT INTO login_bonus_claims(user_id, claim_day, awarded_event_key, total_days,
      streak_days, reward_days, reward_points, balance_after, claimed_at)
    SELECT user_id, NEW.claim_day, NEW.event_key, total_days, streak_days,
      MIN(streak_days, 7), MIN(streak_days, 7) * 500,
      points + MIN(streak_days, 7) * 500, NEW.received_at
    FROM (
      SELECT p.user_id, p.points, COALESCE(s.total_days, 0) + 1 AS total_days,
        CASE WHEN s.last_day = date(NEW.claim_day, '-1 day') THEN s.streak_days + 1 ELSE 1 END AS streak_days
      FROM user_profiles p LEFT JOIN login_bonus_state s ON s.user_id = p.user_id
      WHERE p.user_id = NEW.user_id
    ) WHERE 1
    ON CONFLICT(user_id, claim_day) DO NOTHING;
END;
