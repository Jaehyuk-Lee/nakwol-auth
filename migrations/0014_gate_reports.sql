CREATE TABLE gate_report_tokens (
  client_id TEXT PRIMARY KEY REFERENCES applications(client_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Untrusted, informational CI summaries; never used to grant application access.
CREATE TABLE gate_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES applications(client_id) ON DELETE CASCADE,
  received_at INTEGER NOT NULL,
  summary_json TEXT NOT NULL CHECK(json_valid(summary_json))
);
CREATE INDEX idx_gate_reports_client_recent ON gate_reports(client_id, id DESC);
