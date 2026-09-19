-- Text-length / verified-reply point awards. Additive only: preserve all balances,
-- EXP, cooldowns, old event claims, group data and announcement delivery history.
-- -1 is an internal pending claim, finalized within the same D1 batch transaction.
-- Legacy events default to 0, so their redelivery cannot receive another award.
ALTER TABLE exp_events ADD COLUMN points_delta INTEGER NOT NULL DEFAULT 0
  CHECK (points_delta BETWEEN -1 AND 10);
ALTER TABLE exp_events ADD COLUMN exp_before INTEGER;
ALTER TABLE exp_last_message ADD COLUMN last_event_key TEXT;
