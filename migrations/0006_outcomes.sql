-- D5: outcome capture (the $ recovered metric + retention loop close).

CREATE TABLE outcomes (
  case_id TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  result TEXT NOT NULL,
  amount_recovered_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
