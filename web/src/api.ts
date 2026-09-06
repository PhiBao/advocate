// Typed client for the Advocate API. Mirrors src/worker/types.ts shapes
// (duplicated deliberately: worker and web deploy independently).

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

export interface TimelineEvent {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  created_at: number;
}

export interface CaseFinding {
  code: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  spans: string[];
}

export interface IntakeQuestion {
  key: string;
  prompt: string;
  kind: "yes_no" | "single_choice" | "short_text";
  options: string[];
  answer: string | null;
}

export interface CaseSummary {
  disputeLabel: string;
  deadlineText: string;
  strategy: string;
  evidence: string[];
  nextStep: string;
}

export interface Explainer {
  providerName: string | null;
  payerName: string | null;
  documentKind: string;
  totalBilledCents: number | null;
  insurerPaidCents: number | null;
  patientResponsibilityCents: number | null;
  lines: Array<{ description: string; amountCents: number }>;
}

export interface Letter {
  version: number;
  subject: string;
  bodyMd: string;
  citations: Array<{ span: string; quote: string }>;
  status: "draft" | "approved" | "needs_review";
  issues: string[];
}

export interface FilingGuide {
  payer: string;
  portalUrl: string | null;
  steps: string[];
  note: string;
}

export type OutcomeResult = "won_full" | "reduced" | "denied" | "no_response";

export interface Outcome {
  result: OutcomeResult;
  amountRecoveredCents: number;
  note: string;
  createdAt: number;
}

export interface CasePublic {
  id: string;
  dispute_type: string;
  status: CaseStatus;
  created_at: number;
  updated_at: number;
  payer_name: string | null;
  documents: Array<{
    id: string;
    content_type: string;
    byte_size: number;
    page_count: number | null;
    created_at: number;
  }>;
  timeline: TimelineEvent[];
  findings: CaseFinding[];
  explainer: Explainer | null;
  questions: IntakeQuestion[];
  summary: CaseSummary | null;
  letter: Letter | null;
  filingGuide: FilingGuide;
  outcome: Outcome | null;
}

export interface CreateCaseResponse {
  caseId: string;
  claimToken: string;
  status: CaseStatus;
}

export class ApiRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

async function readError(res: Response): Promise<ApiRequestError> {
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    return new ApiRequestError(
      data.error?.code ?? "UNKNOWN",
      data.error?.message ?? "Something went wrong. Please try again.",
    );
  } catch {
    return new ApiRequestError("UNKNOWN", "Something went wrong. Please try again.");
  }
}

export async function createCase(file: File, signal?: AbortSignal): Promise<CreateCaseResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("disputeType", "medical_bill");
  const init: RequestInit = { method: "POST", body: form };
  if (signal) init.signal = signal;
  const res = await fetch("/api/cases", init);
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CreateCaseResponse;
}

export async function getCase(caseId: string, token: string): Promise<CasePublic> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}?token=${encodeURIComponent(token)}`);
  if (!res.ok) throw await readError(res);
  return (await res.json()) as CasePublic;
}

export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

async function postJson<T>(caseId: string, path: string, payload: unknown): Promise<T> {
  const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export async function fetchQuestions(
  caseId: string,
  token: string,
): Promise<{ questions: IntakeQuestion[] }> {
  return postJson(caseId, "questions", { token });
}

export async function submitAnswers(
  caseId: string,
  token: string,
  answers: Array<{ key: string; value: string }>,
): Promise<{ questions: IntakeQuestion[]; summary: CaseSummary | null }> {
  return postJson(caseId, "answers", { token, answers });
}

export async function ensureLetter(caseId: string, token: string): Promise<{ letter: Letter | null }> {
  return postJson(caseId, "letter", { token });
}

export async function editLetter(
  caseId: string,
  token: string,
  version: number,
  subject: string,
  bodyMd: string,
): Promise<{ letter: Letter }> {
  return postJson(caseId, "letter/edit", { token, version, subject, bodyMd });
}

export async function approveLetter(caseId: string, token: string, version: number): Promise<{ ok: true }> {
  return postJson(caseId, "letter/approve", { token, version });
}

export async function markFiled(
  caseId: string,
  token: string,
  channel: string,
  note: string,
): Promise<{ ok: true }> {
  return postJson(caseId, "filed", { token, channel, note });
}

export async function recordOutcome(
  caseId: string,
  token: string,
  result: OutcomeResult,
  amountRecovered: number,
  note: string,
): Promise<{ outcome: Outcome | null; status: string }> {
  return postJson(caseId, "outcome", { token, result, amountRecovered, note });
}
