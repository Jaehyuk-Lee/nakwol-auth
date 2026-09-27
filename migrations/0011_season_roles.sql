PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS application_role_requirements (
  client_id TEXT PRIMARY KEY REFERENCES applications(client_id) ON DELETE CASCADE,
  role_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(role_ids) AND json_type(role_ids) = 'array'),
  updated_at INTEGER NOT NULL
);
