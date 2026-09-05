// Minimal D1 data-access layer. All timestamps are Unix milliseconds.
// Personal data minimization: we store case state + document metadata here.
// Document bytes live in R2; nothing here is ever sent to model providers
// except through the explicit pipeline stages (D2+).

import type { CasePublic, CaseStatus, DisputeType, Env, TimelineKind } from "./types";

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
  };
}
