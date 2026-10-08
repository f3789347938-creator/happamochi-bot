-- Additive casino storage. Apply only after taking a production D1 backup.
-- One receipt INSERT and its trigger commit the cards, balance and ledger as one
-- SQLite transaction. No unfinished round expires or silently loses its wager.
CREATE TABLE IF NOT EXISTS casino_rounds (
  round_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('draw', 'duel', 'blackjack')),
  stake INTEGER NOT NULL CHECK (typeof(stake) = 'integer' AND stake > 0),
  version INTEGER NOT NULL CHECK (version >= 1),
  finished INTEGER NOT NULL CHECK (finished IN (0, 1)),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  spent INTEGER NOT NULL CHECK (spent >= 0),
  payout INTEGER NOT NULL CHECK (payout >= 0),
  net INTEGER NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (net = payout - spent)
);
CREATE UNIQUE INDEX IF NOT EXISTS casino_one_active_user
  ON casino_rounds(user_id) WHERE finished = 0;
CREATE INDEX IF NOT EXISTS casino_history_user
  ON casino_rounds(user_id, updated_at DESC) WHERE finished = 1;
CREATE INDEX IF NOT EXISTS casino_ledger_user
  ON point_ledger(user_id) WHERE reason IN ('casino_wager', 'casino_payout');

-- These are private server receipts: state_json includes the undealt deck.
-- Receipts are never returned to a client; only engine.publicRound is exposed.
CREATE TABLE IF NOT EXISTS casino_receipts (
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  round_id TEXT NOT NULL,
  expected_version INTEGER NOT NULL CHECK (expected_version >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('draw', 'duel', 'blackjack')),
  stake INTEGER NOT NULL CHECK (typeof(stake) = 'integer' AND stake > 0),
  version INTEGER NOT NULL,
  finished INTEGER NOT NULL CHECK (finished IN (0, 1)),
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  spent INTEGER NOT NULL CHECK (typeof(spent) = 'integer' AND spent >= 0),
  payout INTEGER NOT NULL CHECK (typeof(payout) = 'integer' AND payout >= 0),
  net INTEGER NOT NULL,
  result TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (typeof(cost) = 'integer' AND cost >= 0),
  delta INTEGER NOT NULL CHECK (typeof(delta) = 'integer' AND delta + cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, request_id),
  CHECK (version = expected_version + 1),
  CHECK (net = payout - spent),
  CHECK (json_extract(state_json, '$.id') = round_id),
  CHECK (json_extract(state_json, '$.version') = version),
  CHECK (json_extract(state_json, '$.mode') = mode),
  CHECK (json_extract(state_json, '$.stake') = stake),
  CHECK (json_extract(state_json, '$.finished') = finished)
);

CREATE TRIGGER IF NOT EXISTS casino_commit_receipt
AFTER INSERT ON casino_receipts
BEGIN
  SELECT RAISE(ABORT, 'casino_profile_missing') WHERE NOT EXISTS
    (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id);
  -- Check the wager BEFORE its possible return. A winning double/natural is not
  -- permission to place a wager the player could not afford.
  SELECT RAISE(ABORT, 'casino_insufficient_points') WHERE EXISTS
    (SELECT 1 FROM user_profiles WHERE user_id = NEW.user_id
     AND (points < NEW.cost OR points + NEW.delta < 0));
  SELECT RAISE(ABORT, 'casino_active_round') WHERE NEW.expected_version = 0
    AND EXISTS (SELECT 1 FROM casino_rounds WHERE user_id = NEW.user_id AND finished = 0);
  SELECT RAISE(ABORT, 'casino_round_conflict') WHERE NEW.expected_version = 0
    AND EXISTS (SELECT 1 FROM casino_rounds WHERE round_id = NEW.round_id);
  SELECT RAISE(ABORT, 'casino_stale_round') WHERE NEW.expected_version > 0
    AND NOT EXISTS (SELECT 1 FROM casino_rounds WHERE round_id = NEW.round_id
      AND user_id = NEW.user_id AND version = NEW.expected_version AND finished = 0
      AND mode = NEW.mode AND stake = NEW.stake);
  SELECT RAISE(ABORT, 'casino_invalid_accounting') WHERE NEW.expected_version = 0
    AND (NEW.cost != NEW.spent OR NEW.delta != NEW.net);
  SELECT RAISE(ABORT, 'casino_invalid_accounting') WHERE NEW.expected_version > 0
    AND EXISTS (SELECT 1 FROM casino_rounds WHERE round_id = NEW.round_id
      AND (NEW.spent != spent + NEW.cost OR NEW.delta != NEW.net - net OR NEW.payout < payout));

  INSERT INTO casino_rounds
    (round_id, user_id, mode, stake, version, finished, state_json, spent, payout, net, result)
    VALUES (NEW.round_id, NEW.user_id, NEW.mode, NEW.stake, NEW.version,
      NEW.finished, NEW.state_json, NEW.spent, NEW.payout, NEW.net, NEW.result)
    ON CONFLICT(round_id) DO UPDATE SET version = NEW.version,
      finished = NEW.finished, state_json = NEW.state_json, spent = NEW.spent,
      payout = NEW.payout, net = NEW.net, result = NEW.result,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
  UPDATE user_profiles SET points = points + NEW.delta, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id;
  INSERT INTO point_ledger (user_id, delta, reason, reason_key)
    SELECT NEW.user_id, -NEW.cost, 'casino_wager',
      'casino:' || NEW.user_id || ':' || NEW.request_id || ':wager' WHERE NEW.cost > 0;
  INSERT INTO point_ledger (user_id, delta, reason, reason_key)
    SELECT NEW.user_id, NEW.delta + NEW.cost, 'casino_payout',
      'casino:' || NEW.user_id || ':' || NEW.request_id || ':payout'
      WHERE NEW.delta + NEW.cost > 0;
END;
