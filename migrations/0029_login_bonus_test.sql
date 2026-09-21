-- Optional owner-only testing awards. Authorization uses a private Worker
-- secret in the application; no actual LINE UID is stored in this migration.
-- Daily claims/state remain unchanged, and one signed event can award once.
CREATE TABLE IF NOT EXISTS login_bonus_test_claims (
  user_id TEXT NOT NULL,
  event_key TEXT NOT NULL CHECK (length(event_key) BETWEEN 1 AND 256),
  claim_day TEXT NOT NULL CHECK (claim_day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  total_days INTEGER NOT NULL CHECK (typeof(total_days) = 'integer' AND total_days >= 1),
  streak_days INTEGER NOT NULL CHECK (typeof(streak_days) = 'integer' AND streak_days BETWEEN 1 AND total_days),
  reward_days INTEGER NOT NULL CHECK (reward_days = MIN(streak_days, 7)),
  reward_points INTEGER NOT NULL CHECK (reward_points = reward_days * 500),
  balance_after INTEGER NOT NULL CHECK (typeof(balance_after) = 'integer' AND balance_after >= reward_points),
  claimed_at INTEGER NOT NULL CHECK (typeof(claimed_at) = 'integer' AND claimed_at >= 0),
  PRIMARY KEY (user_id, event_key)
);

CREATE TRIGGER IF NOT EXISTS login_bonus_test_credit
AFTER INSERT ON login_bonus_test_claims
BEGIN
  SELECT RAISE(ABORT, 'login_bonus_test_profile_missing')
    WHERE NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id);
  SELECT RAISE(ABORT, 'login_bonus_test_receipt_invalid') WHERE NOT EXISTS (
    SELECT 1 FROM login_bonus_events e
    JOIN login_bonus_claims c ON c.user_id = e.user_id AND c.claim_day = e.claim_day
    WHERE e.user_id = NEW.user_id AND e.event_key = NEW.event_key
      AND e.claim_day = NEW.claim_day AND e.event_key <> c.awarded_event_key
      AND c.total_days = NEW.total_days AND c.streak_days = NEW.streak_days
      AND c.reward_days = NEW.reward_days AND c.reward_points = NEW.reward_points
  );
  UPDATE user_profiles SET points = points + NEW.reward_points, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id;
  INSERT INTO point_ledger(user_id, delta, reason, reason_key)
    VALUES(NEW.user_id, NEW.reward_points, 'login_bonus_test', 'login-test:' || NEW.user_id || ':' || NEW.event_key);
END;
