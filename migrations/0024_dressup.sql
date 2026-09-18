-- Cosmetics are additive: existing EXP, balances, themes and rankings are unchanged.
-- A draw is ONE confirmation UPDATE. Its triggers debit, grant and write the
-- ledger in the same SQLite transaction; failure rolls the whole statement back.
CREATE TABLE IF NOT EXISTS dressup_catalog (
  item_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('costume', 'background')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

INSERT OR IGNORE INTO dressup_catalog (item_id, kind, is_default)
VALUES ('C000', 'costume', 1), ('BG000', 'background', 1);

WITH RECURSIVE numbers(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 120
)
INSERT OR IGNORE INTO dressup_catalog (item_id, kind)
SELECT printf('C%03d', n), 'costume' FROM numbers;

WITH RECURSIVE numbers(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 30
)
INSERT OR IGNORE INTO dressup_catalog (item_id, kind)
SELECT printf('BG%03d', n), 'background' FROM numbers;

CREATE TABLE IF NOT EXISTS dressup_inventory (
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES dressup_catalog(item_id),
  obtained_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS dressup_appearances (
  user_id TEXT PRIMARY KEY REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  costume_id TEXT NOT NULL DEFAULT 'C000' REFERENCES dressup_catalog(item_id),
  background_id TEXT NOT NULL DEFAULT 'BG000' REFERENCES dressup_catalog(item_id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (costume_id GLOB 'C[0-9][0-9][0-9]'),
  CHECK (background_id GLOB 'BG[0-9][0-9][0-9]')
);

CREATE TABLE IF NOT EXISTS dressup_confirmations (
  token TEXT PRIMARY KEY CHECK (length(token) = 36),
  user_id TEXT NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'canceled', 'drawn')),
  expires_at INTEGER NOT NULL,
  item_id TEXT REFERENCES dressup_catalog(item_id),
  balance_after INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (state = 'drawn' AND item_id IS NOT NULL AND balance_after IS NOT NULL AND balance_after >= 0)
    OR (state <> 'drawn' AND item_id IS NULL AND balance_after IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_dressup_confirmation_user
  ON dressup_confirmations(user_id, state, expires_at);

CREATE TRIGGER IF NOT EXISTS dressup_confirmation_insert_guard
BEFORE INSERT ON dressup_confirmations
WHEN NEW.state <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'dressup_confirmation_must_start_pending');
END;

CREATE TRIGGER IF NOT EXISTS dressup_confirmation_transition_guard
BEFORE UPDATE ON dressup_confirmations
BEGIN
  -- Use WHERE guards rather than nested CASE/END expressions: remote D1 SQL
  -- statement splitting must only encounter the trigger's final END token.
  SELECT RAISE(ABORT, 'dressup_invalid_transition')
    WHERE OLD.state <> 'pending' OR NEW.state NOT IN ('canceled', 'drawn')
    OR NEW.token <> OLD.token OR NEW.user_id <> OLD.user_id
    OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at;
  SELECT RAISE(ABORT, 'dressup_confirmation_expired')
    WHERE NEW.state = 'drawn' AND OLD.expires_at <= unixepoch();
  SELECT RAISE(ABORT, 'dressup_insufficient_points')
    WHERE NEW.state = 'drawn' AND NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE user_id = NEW.user_id AND points >= 3000 AND NEW.balance_after = points - 3000
  );
  SELECT RAISE(ABORT, 'dressup_invalid_award')
    WHERE NEW.state = 'drawn' AND NOT EXISTS (
    SELECT 1 FROM dressup_catalog c WHERE c.item_id = NEW.item_id AND c.is_default = 0
      AND NOT EXISTS (SELECT 1 FROM dressup_inventory i
        WHERE i.user_id = NEW.user_id AND i.item_id = c.item_id)
  );
END;

CREATE TRIGGER IF NOT EXISTS dressup_confirmation_award
AFTER UPDATE OF state ON dressup_confirmations
WHEN OLD.state = 'pending' AND NEW.state = 'drawn'
BEGIN
  UPDATE user_profiles SET points = points - 3000, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = NEW.user_id AND points >= 3000;
  SELECT RAISE(ABORT, 'dressup_debit_failed') WHERE changes() <> 1;
  INSERT INTO dressup_inventory (user_id, item_id) VALUES (NEW.user_id, NEW.item_id);
  INSERT INTO point_ledger (user_id, delta, reason, reason_key)
    VALUES (NEW.user_id, -3000, 'dressup_gacha', 'dressup:' || NEW.token);
END;
