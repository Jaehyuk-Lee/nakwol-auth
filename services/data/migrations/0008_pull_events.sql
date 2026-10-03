-- D1 applies migrations in a transaction; nothing references data_application_scopes, and
-- deferred checks cover the copy.
PRAGMA defer_foreign_keys = true;

-- Add pulls:read / pulls:write. SQLite cannot change a CHECK constraint in place, so the
-- scope table is rebuilt with every existing grant copied over.
CREATE TABLE data_application_scopes_v4 (
  client_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('profile:read','profile:write','roster:read','roster:write','equipment:read','equipment:write','decks:read','decks:write','pulls:read','pulls:write')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(client_id,scope),
  FOREIGN KEY(client_id) REFERENCES data_applications(client_id) ON DELETE CASCADE
);
INSERT INTO data_application_scopes_v4(client_id,scope,created_at)
  SELECT client_id,scope,created_at FROM data_application_scopes;
DROP TABLE data_application_scopes;
ALTER TABLE data_application_scopes_v4 RENAME TO data_application_scopes;

-- Pull (탐방) records owned by a game account. event_json is the normalized record; deleted
-- rows stay for history.
CREATE TABLE pull_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  banner TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK(seq >= 1),
  rev INTEGER NOT NULL CHECK(rev >= 1),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  event_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);
CREATE INDEX idx_pull_events_account_order ON pull_events(account_id, created_at, id);

-- Append-only change feed read by aggregating services. No foreign keys: history outlives
-- the account.
CREATE TABLE pull_event_changes (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  account_nickname TEXT,
  rev INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','replace','delete')),
  event_json TEXT,
  previous_json TEXT,
  created_at INTEGER NOT NULL
);

-- Revision guard: an edit batch inserts NULL here when its guarded UPDATE matched no row,
-- which aborts the whole batch.
CREATE TABLE pull_event_guard (ok INTEGER NOT NULL);

-- Rows removed with their account or user still leave a delete in the feed.
CREATE TRIGGER pull_events_hard_delete AFTER DELETE ON pull_events WHEN OLD.deleted = 0
BEGIN
  INSERT INTO pull_event_changes(event_id,account_id,user_id,account_nickname,rev,action,event_json,previous_json,created_at)
  VALUES (OLD.id, OLD.account_id, OLD.user_id, NULL, OLD.rev + 1, 'delete', NULL, OLD.event_json, CAST(unixepoch('subsec') * 1000 AS INTEGER));
END;

UPDATE data_schema_meta SET value = '4' WHERE key = 'schema_version';
