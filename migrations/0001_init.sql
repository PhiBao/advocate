-- Advocate D1 schema, migration 0001.
-- Cases are keyed by random UUID. No user accounts in v1: case access is via
-- signed, expiring claim tokens (see src/worker/tokens.ts).

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  dispute_type TEXT NOT NULL DEFAULT 'medical_bill',
  status TEXT NOT NULL DEFAULT 'uploaded',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Unix timestamp after which the case + documents are eligible for deletion.
  delete_after INTEGER NOT NULL,
  contact_email TEXT,
  payer_name TEXT
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  page_count INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_documents_case ON documents(case_id);

CREATE TABLE timeline_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_timeline_case ON timeline_events(case_id, created_at);
