-- Track when the bot leaves a group, so group_metadata reflects current
-- membership state instead of silently going stale forever.
-- Uses ALTER TABLE ADD COLUMN (safe, additive) — never drops/recreates
-- the existing group_metadata table or its data.
ALTER TABLE group_metadata ADD COLUMN left_at DATETIME;
