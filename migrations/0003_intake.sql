-- D3: guided intake questions + case summary.

CREATE TABLE intake_questions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  qkey TEXT NOT NULL,
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  answer TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(case_id, qkey)
);

CREATE TABLE case_summaries (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  dispute_label TEXT NOT NULL,
  deadline_text TEXT NOT NULL,
  strategy TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  next_step TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
