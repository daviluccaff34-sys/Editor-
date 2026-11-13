-- Editor++ online room directory.
-- LAN rooms are intentionally not stored here.

CREATE TABLE IF NOT EXISTS rooms (
  room_code TEXT PRIMARY KEY,
  host_gd_account_id TEXT NOT NULL,
  host_player_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed')),
  player_count INTEGER NOT NULL DEFAULT 1
    CHECK (player_count BETWEEN 1 AND 4),
  max_players INTEGER NOT NULL DEFAULT 4
    CHECK (max_players = 4),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rooms_status_updated
  ON rooms(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_rooms_host_status
  ON rooms(host_gd_account_id, status);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  room_code TEXT,
  admin_subject TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
