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
