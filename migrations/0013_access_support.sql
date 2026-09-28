CREATE TABLE application_access_grants (
  client_id TEXT NOT NULL REFERENCES applications(client_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  reason TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(client_id, discord_user_id)
);
CREATE TABLE user_reauthentication (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_at INTEGER NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL
);
CREATE INDEX idx_auth_events_app_time ON auth_events(client_id, created_at DESC, id DESC);
