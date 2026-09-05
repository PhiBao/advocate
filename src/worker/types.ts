// Shared domain + environment types for the Advocate Worker.
// Keep this file dependency-free so it can be imported anywhere.

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  CASE_DO: DurableObjectNamespace;
  /** HMAC secret for case claim tokens. Set via `wrangler secret put`. */
  CLAIM_TOKEN_SECRET: string;
  /** LLM key. Set via `wrangler secret put`. Absent in local dev. */
  ANTHROPIC_API_KEY?: string;
  APP_BASE_URL: string;
  CLAIM_TOKEN_TTL_SECONDS: string;
  MAX_UPLOAD_BYTES: string;
  DATA_RETENTION_DAYS: string;
}

export type DisputeType = "medical_bill";

export type CaseStatus =
  | "uploaded"
  | "reading"
  | "needs_info"
  | "ready_for_review"
  | "approved"
  | "filed"
  | "in_followup"
  | "resolved"
  | "closed";

export type TimelineKind =
  | "case_created"
  | "document_uploaded"
  | "reading_started"
  | "findings_ready"
  | "question_asked"
  | "question_answered"
  | "letter_ready"
  | "letter_approved"
  | "filed"
  | "call_scheduled"
  | "call_completed"
  | "deadline_reminder"
  | "escalated"
  | "outcome_recorded"
  | "note";

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  title: string;
  body: string | null;
  created_at: number;
}

export interface DocumentMeta {
  id: string;
  content_type: string;
  byte_size: number;
  page_count: number | null;
  created_at: number;
}

export interface CasePublic {
  id: string;
  dispute_type: DisputeType;
  status: CaseStatus;
  created_at: number;
  updated_at: number;
  payer_name: string | null;
  documents: DocumentMeta[];
  timeline: TimelineEvent[];
}

/** API error envelope. Internal details must never leak to clients. */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export function apiError(code: string, message: string, status = 400): Response {
  const body: ApiError = { error: { code, message } };
  return Response.json(body, { status });
}
