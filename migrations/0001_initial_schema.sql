-- HappaMochi Bot (葉っぱもち) - Initial schema
-- IMPORTANT: All statements use IF NOT EXISTS because the production D1
-- database (line-group-bbs-db) already contains live data (300k+ messages,
-- 7000+ members). This migration must NEVER drop or recreate existing tables.

CREATE TABLE IF NOT EXISTS group_metadata (
  group_id TEXT PRIMARY KEY,
  group_name TEXT,
  size_category TEXT,
  group_category TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_active_at DATETIME,
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  activity_date DATE NOT NULL,
  message_count INTEGER DEFAULT 1,
  UNIQUE(group_id, user_id, activity_date)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT,
  picture_url TEXT,
  message_text TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, message_id)
);

CREATE TABLE IF NOT EXISTS line_friends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_user_id TEXT UNIQUE NOT NULL,
  display_name TEXT,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_notified_at DATETIME
);

-- ─── Unsend (message deletion) detection & notification ───
-- unsent_messages holds the ORIGINAL content of a message once LINE tells us
-- it was unsent (deleted). notified=0 means we still owe the group a
-- notification; it gets flipped to 1 once we actually deliver it via the
-- free Reply API (piggybacking on the next incoming message in that group).
CREATE TABLE IF NOT EXISTS unsent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  message_text TEXT NOT NULL,
  sent_at DATETIME NOT NULL,
  unsent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  notified INTEGER DEFAULT 0,
  UNIQUE(group_id, message_id)
);

CREATE TABLE IF NOT EXISTS unsend_notification_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delete_key TEXT UNIQUE NOT NULL,
  group_id TEXT NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS unsend_restore_settings (
  group_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS unsend_debug_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  found_in_db INTEGER NOT NULL,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body TEXT,
  message_preview TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_debug_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  request_body TEXT NOT NULL,
  has_signature INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  event_type TEXT,
  error_message TEXT
);

-- ─── Birthdays ───
CREATE TABLE IF NOT EXISTS member_birthdays (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  birth_month INTEGER NOT NULL,
  birth_day INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS daily_fortune_sent (
  group_id TEXT NOT NULL,
  sent_date DATE NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, sent_date)
);

-- ─── Zodiac fortune ───
CREATE TABLE IF NOT EXISTS user_zodiac_signs (
  user_id TEXT PRIMARY KEY,
  zodiac_sign TEXT NOT NULL,
  registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS daily_zodiac_fortunes (
  date DATE NOT NULL,
  zodiac_sign TEXT NOT NULL,
  ranking INTEGER NOT NULL,
  overall_fortune TEXT NOT NULL,
  love_fortune TEXT NOT NULL,
  money_fortune TEXT NOT NULL,
  work_fortune TEXT NOT NULL,
  lucky_item TEXT NOT NULL,
  lucky_color TEXT NOT NULL,
  lucky_number INTEGER NOT NULL,
  advice TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (date, zodiac_sign)
);

-- ─── Ranking ───
CREATE TABLE IF NOT EXISTS group_rankings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  rank_date DATE NOT NULL,
  overall_rank INTEGER,
  size_category_rank INTEGER,
  category_rank INTEGER,
  float_rate REAL,
  total_members INTEGER,
  active_members INTEGER,
  total_groups INTEGER,
  UNIQUE(group_id, rank_date)
);

CREATE TABLE IF NOT EXISTS weekly_ranking_sends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  week_start_date DATE NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, week_start_date)
);

-- ─── Welcome message ───
CREATE TABLE IF NOT EXISTS group_welcome_settings (
  group_id TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  custom_message TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─── Tags ───
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag_name TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_tags (
  group_id TEXT NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, tag_id)
);

-- ─── Quote images ───
CREATE TABLE IF NOT EXISTS quote_images (
  id TEXT PRIMARY KEY,
  image_data BLOB NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  quote_text TEXT,
  author_name TEXT
);

-- ─── Misc progress tracking ───
CREATE TABLE IF NOT EXISTS member_update_progress (
  group_id TEXT PRIMARY KEY,
  processed_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_states (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  state TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
