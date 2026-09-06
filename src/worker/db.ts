// Minimal D1 data-access layer. All timestamps are Unix milliseconds.
// Personal data minimization: we store case state + document metadata here.
// Document bytes live in R2; nothing here is ever sent to model providers
// except through the explicit pipeline stages (D2+).

import type { CasePublic, CaseStatus, DisputeType, Env, OutcomeResult, TimelineKind } from "./types";
import type { CaseExtraction } from "./extract";
import { buildExplainer, type CaseSummary, type IntakeQuestion } from "./intake";
import { guideForPayer } from "./guides";
import type { LetterStatus } from "./letter";
import type { Finding } from "./rules";

function now(): number {
  return Date.now();
}

export async function createCase(
  env: Env,
  opts: { id: string; disputeType: DisputeType; retentionDays: number },
): Promise<void> {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO cases (id, dispute_type, status, created_at, updated_at, delete_after)
     VALUES (?1, ?2, 'uploaded', ?3, ?3, ?4)`,
  )
    .bind(opts.id, opts.disputeType, t, t + opts.retentionDays * 86_400_000)
    .run();
}

export async function addDocument(
  env: Env,
  opts: {
    id: string;
    caseId: string;
    objectKey: string;
    contentType: string;
    byteSize: number;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO documents (id, case_id, object_key, content_type, byte_size, page_count, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)`,
  )
    .bind(opts.id, opts.caseId, opts.objectKey, opts.contentType, opts.byteSize, now())
    .run();
}

export async function setCaseStatus(env: Env, caseId: string, status: CaseStatus): Promise<void> {
  await env.DB.prepare(`UPDATE cases SET status = ?1, updated_at = ?2 WHERE id = ?3`)
    .bind(status, now(), caseId)
    .run();
}

export async function addTimelineEvent(
  env: Env,
  opts: { caseId: string; kind: TimelineKind; title: string; body?: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO timeline_events (id, case_id, kind, title, body, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(crypto.randomUUID(), opts.caseId, opts.kind, opts.title, opts.body ?? null, now())
    .run();
}

export async function getCasePublic(env: Env, caseId: string): Promise<CasePublic | null> {
  const row = await env.DB.prepare(
    `SELECT id, dispute_type, status, created_at, updated_at, payer_name
     FROM cases WHERE id = ?1`,
  )
    .bind(caseId)
    .first<{
      id: string;
      dispute_type: DisputeType;
      status: CaseStatus;
      created_at: number;
      updated_at: number;
      payer_name: string | null;
    }>();
  if (!row) return null;

  const extractions = await getExtractions(env, caseId);

  const docs = await env.DB.prepare(
    `SELECT id, content_type, byte_size, page_count, created_at
     FROM documents WHERE case_id = ?1 ORDER BY created_at ASC`,
  )
    .bind(caseId)
    .all<{ id: string; content_type: string; byte_size: number; page_count: number | null; created_at: number }>();

  const timeline = await env.DB.prepare(
    `SELECT id, kind, title, body, created_at
     FROM timeline_events WHERE case_id = ?1 ORDER BY created_at ASC LIMIT 200`,
  )
    .bind(caseId)
    .all<{ id: string; kind: TimelineKind; title: string; body: string | null; created_at: number }>();

  return {
    id: row.id,
    dispute_type: row.dispute_type,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    payer_name: row.payer_name,
    documents: (docs.results ?? []).map((d) => ({
      id: d.id,
      content_type: d.content_type,
      byte_size: d.byte_size,
      page_count: d.page_count,
      created_at: d.created_at,
    })),
    timeline: (timeline.results ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      created_at: e.created_at,
    })),
    findings: await getFindings(env, caseId),
    explainer: buildExplainer(extractions),
    questions: await getQuestions(env, caseId),
    summary: await getSummary(env, caseId),
    letter: await getLetterWire(env, caseId),
    filingGuide: guideForPayer(row.payer_name ?? firstPayer(extractions)),
    outcome: await getOutcome(env, caseId),
  };
}

function firstPayer(extractions: CaseExtraction[]): string | null {
  for (const e of extractions) {
    if (e.payerName) return e.payerName;
  }
  return null;
}

async function getLetterWire(
  env: Env,
  caseId: string,
): Promise<CasePublic["letter"]> {
  const latest = await getLatestLetter(env, caseId);
  if (!latest) return null;
  return {
    version: latest.version,
    subject: latest.subject,
    bodyMd: latest.bodyMd,
    citations: latest.citations,
    status: latest.status,
    issues: latest.issues,
  };
}

export interface StoredDocument {
  id: string;
  object_key: string;
  content_type: string;
}

export async function listDocuments(env: Env, caseId: string): Promise<StoredDocument[]> {
  const res = await env.DB.prepare(
    `SELECT id, object_key, content_type FROM documents WHERE case_id = ?1 ORDER BY created_at ASC`,
  )
    .bind(caseId)
    .all<{ id: string; object_key: string; content_type: string }>();
  return (res.results ?? []).map((d) => ({
    id: d.id,
    object_key: d.object_key,
    content_type: d.content_type,
  }));
}

export async function saveExtraction(
  env: Env,
  opts: { caseId: string; documentId: string; json: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO extractions (id, case_id, document_id, json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(crypto.randomUUID(), opts.caseId, opts.documentId, opts.json, Date.now())
    .run();
}

/** Replace all findings for a case (pipeline runs are idempotent). */
export async function saveFindings(env: Env, caseId: string, findings: Finding[]): Promise<void> {
  const batch: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM findings WHERE case_id = ?1`).bind(caseId),
  ];
  for (const f of findings) {
    batch.push(
      env.DB.prepare(
        `INSERT INTO findings (id, case_id, code, severity, title, detail, spans_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      ).bind(
        crypto.randomUUID(),
        caseId,
        f.code,
        f.severity,
        f.title,
        f.detail,
        JSON.stringify(f.spans),
        Date.now(),
      ),
    );
  }
  await env.DB.batch(batch);
}

export async function getFindings(
  env: Env,
  caseId: string,
): Promise<CasePublic["findings"]> {  const res = await env.DB.prepare(
    `SELECT code, severity, title, detail, spans_json
     FROM findings WHERE case_id = ?1 ORDER BY created_at ASC LIMIT 50`,
  )
    .bind(caseId)
    .all<{ code: string; severity: string; title: string; detail: string; spans_json: string }>();
  return (res.results ?? []).map((f) => {
    let spans: string[] = [];
    try {
      const parsed: unknown = JSON.parse(f.spans_json);
      if (Array.isArray(parsed)) spans = parsed.filter((s): s is string => typeof s === "string");
    } catch {
      spans = [];
    }
    return {
      code: f.code,
      severity: f.severity === "high" || f.severity === "medium" ? f.severity : "info",
      title: f.title,
      detail: f.detail,
      spans,
    };
  });
}

export async function getExtractions(env: Env, caseId: string): Promise<CaseExtraction[]> {
  const res = await env.DB.prepare(`SELECT json FROM extractions WHERE case_id = ?1 ORDER BY created_at ASC`)
    .bind(caseId)
    .all<{ json: string }>();
  const out: CaseExtraction[] = [];
  for (const row of res.results ?? []) {
    try {
      out.push(JSON.parse(row.json) as CaseExtraction);
    } catch {
      // Corrupt extraction rows are skipped; findings remain the source of truth.
    }
  }
  return out;
}

function parseOptions(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** Insert questions if none exist (idempotent); return current set with answers. */
export async function ensureQuestions(
  env: Env,
  caseId: string,
  questions: IntakeQuestion[],
): Promise<IntakeQuestion[]> {
  const existing = await getQuestions(env, caseId);
  if (existing.length > 0) return existing;
  const batch = questions.map((q) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO intake_questions (id, case_id, qkey, prompt, kind, options_json, answer, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)`,
    ).bind(crypto.randomUUID(), caseId, q.key, q.prompt, q.kind, JSON.stringify(q.options), Date.now()),
  );
  if (batch.length > 0) await env.DB.batch(batch);
  return getQuestions(env, caseId);
}

export async function getQuestions(env: Env, caseId: string): Promise<IntakeQuestion[]> {
  const res = await env.DB.prepare(
    `SELECT qkey, prompt, kind, options_json, answer FROM intake_questions
     WHERE case_id = ?1 ORDER BY created_at ASC LIMIT 12`,
  )
    .bind(caseId)
    .all<{ qkey: string; prompt: string; kind: string; options_json: string; answer: string | null }>();
  return (res.results ?? []).map((r) => ({
    key: r.qkey,
    prompt: r.prompt,
    kind: r.kind === "single_choice" || r.kind === "short_text" ? r.kind : "yes_no",
    options: parseOptions(r.options_json),
    answer: r.answer,
  }));
}

export async function saveAnswers(
  env: Env,
  caseId: string,
  answers: Array<{ key: string; value: string }>,
): Promise<void> {
  const batch = answers.map((a) =>
    env.DB.prepare(`UPDATE intake_questions SET answer = ?1 WHERE case_id = ?2 AND qkey = ?3`).bind(
      a.value.slice(0, 500),
      caseId,
      a.key,
    ),
  );
  if (batch.length > 0) await env.DB.batch(batch);
}

export async function saveSummary(env: Env, caseId: string, s: CaseSummary): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO case_summaries (case_id, dispute_label, deadline_text, strategy, evidence_json, next_step, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(case_id) DO UPDATE SET
       dispute_label = excluded.dispute_label,
       deadline_text = excluded.deadline_text,
       strategy = excluded.strategy,
       evidence_json = excluded.evidence_json,
       next_step = excluded.next_step,
       created_at = excluded.created_at`,
  )
    .bind(caseId, s.disputeLabel, s.deadlineText, s.strategy, JSON.stringify(s.evidence), s.nextStep, Date.now())
    .run();
}

export interface StoredLetter {
  id: string;
  version: number;
  subject: string;
  bodyMd: string;
  citations: Array<{ span: string; quote: string }>;
  status: LetterStatus;
  issues: string[];
}

function parseCitations(json: string): StoredLetter["citations"] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (c): c is { span: string; quote: string } =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as { span?: unknown }).span === "string" &&
          typeof (c as { quote?: unknown }).quote === "string",
      )
      .map((c) => ({ span: c.span, quote: c.quote }));
  } catch {
    return [];
  }
}

export async function getLatestLetter(env: Env, caseId: string): Promise<StoredLetter | null> {
  const row = await env.DB.prepare(
    `SELECT id, version, subject, body_md, citations_json, status, issues_json
     FROM letters WHERE case_id = ?1 ORDER BY version DESC LIMIT 1`,
  )
    .bind(caseId)
    .first<{
      id: string;
      version: number;
      subject: string;
      body_md: string;
      citations_json: string;
      status: string;
      issues_json: string | null;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    subject: row.subject,
    bodyMd: row.body_md,
    citations: parseCitations(row.citations_json),
    status: row.status === "approved" || row.status === "needs_review" ? row.status : "draft",
    issues: parseOptions(row.issues_json ?? "[]"),
  };
}

export async function saveLetterVersion(
  env: Env,
  caseId: string,
  draft: { subject: string; bodyMd: string; citations: Array<{ span: string; quote: string }> },
  status: LetterStatus,
  issues: string[] = [],
): Promise<StoredLetter> {
  const latest = await getLatestLetter(env, caseId);
  const version = (latest?.version ?? 0) + 1;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO letters (id, case_id, version, subject, body_md, citations_json, status, issues_json, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(id, caseId, version, draft.subject, draft.bodyMd, JSON.stringify(draft.citations), status, JSON.stringify(issues), Date.now())
    .run();
  return { id, version, subject: draft.subject, bodyMd: draft.bodyMd, citations: draft.citations, status, issues };
}

export async function setLetterStatus(env: Env, letterId: string, status: LetterStatus): Promise<void> {
  await env.DB.prepare(`UPDATE letters SET status = ?1 WHERE id = ?2`).bind(status, letterId).run();
}

export async function getOutcome(env: Env, caseId: string): Promise<CasePublic["outcome"]> {
  const row = await env.DB.prepare(
    `SELECT result, amount_recovered_cents, note, created_at FROM outcomes WHERE case_id = ?1`,
  )
    .bind(caseId)
    .first<{ result: string; amount_recovered_cents: number; note: string; created_at: number }>();
  if (!row) return null;
  const result: OutcomeResult =
    row.result === "won_full" || row.result === "reduced" || row.result === "denied" || row.result === "no_response"
      ? row.result
      : "no_response";
  return {
    result,
    amountRecoveredCents: Number.isFinite(row.amount_recovered_cents) ? Math.max(0, row.amount_recovered_cents) : 0,
    note: row.note,
    createdAt: row.created_at,
  };
}

export async function saveOutcome(
  env: Env,
  opts: { caseId: string; result: OutcomeResult; amountRecoveredCents: number; note: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO outcomes (case_id, result, amount_recovered_cents, note, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(case_id) DO UPDATE SET
       result = excluded.result,
       amount_recovered_cents = excluded.amount_recovered_cents,
       note = excluded.note,
       created_at = excluded.created_at`,
  )
    .bind(opts.caseId, opts.result, opts.amountRecoveredCents, opts.note, Date.now())
    .run();
}

export async function addDelivery(
  env: Env,
  opts: { caseId: string; letterId: string; channel: string; detail: string },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO deliveries (id, case_id, letter_id, channel, detail, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(crypto.randomUUID(), opts.caseId, opts.letterId, opts.channel, opts.detail, Date.now())
    .run();
}

export async function getSummary(env: Env, caseId: string): Promise<CaseSummary | null> {
  const row = await env.DB.prepare(
    `SELECT dispute_label, deadline_text, strategy, evidence_json, next_step
     FROM case_summaries WHERE case_id = ?1`,
  )
    .bind(caseId)
    .first<{
      dispute_label: string;
      deadline_text: string;
      strategy: string;
      evidence_json: string;
      next_step: string;
    }>();
  if (!row) return null;
  return {
    disputeLabel: row.dispute_label,
    deadlineText: row.deadline_text,
    strategy: row.strategy,
    evidence: parseOptions(row.evidence_json),
    nextStep: row.next_step,
  };
}
