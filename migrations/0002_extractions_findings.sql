-- D2: store machine extraction + deterministic findings per case.

CREATE TABLE extractions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_extractions_case ON extractions(case_id);

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  spans_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_findings_case ON findings(case_id);
