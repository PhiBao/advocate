-- D4 fix: persist verification problems per letter version so the
-- needs_review state (and its reasons) survives reloads.

ALTER TABLE letters ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]';
