-- Title (称号) system.
-- These tables already exist in the live production DB (line-group-bbs-db)
-- with real data (5 seeded titles, 2 granted). Definitions here are IF NOT
-- EXISTS and match the production schema exactly, so this migration is a
-- no-op against prod and only creates the tables fresh in local/dev DBs.

CREATE TABLE IF NOT EXISTS title_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  rarity TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_titles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  title_id INTEGER NOT NULL,
  is_equipped INTEGER DEFAULT 0,
  obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, group_id, title_id)
);

-- Seed data only if the table is empty (keeps prod's existing 5 rows intact,
-- populates a fresh local/dev DB so testing the title commands works there too).
INSERT INTO title_master (title_name, description, rarity)
SELECT '伝説の勇者', '伝説に語り継がれる存在', 'SSR'
WHERE NOT EXISTS (SELECT 1 FROM title_master WHERE title_name = '伝説の勇者');

INSERT INTO title_master (title_name, description, rarity)
SELECT '時空の支配者', '時間と空間を操る者', 'SSR'
WHERE NOT EXISTS (SELECT 1 FROM title_master WHERE title_name = '時空の支配者');

INSERT INTO title_master (title_name, description, rarity)
SELECT '宇宙の創造主', '全ての始まりを司る存在', 'SSR'
WHERE NOT EXISTS (SELECT 1 FROM title_master WHERE title_name = '宇宙の創造主');

INSERT INTO title_master (title_name, description, rarity)
SELECT '絶対王者', '誰も逆らえない絶対的な力', 'SSR'
WHERE NOT EXISTS (SELECT 1 FROM title_master WHERE title_name = '絶対王者');

INSERT INTO title_master (title_name, description, rarity)
SELECT '真実の探求者', '真理を追い求める者', 'SSR'
WHERE NOT EXISTS (SELECT 1 FROM title_master WHERE title_name = '真実の探求者');
