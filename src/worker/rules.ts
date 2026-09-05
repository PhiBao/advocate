// Deterministic red-flag rules engine (scaffold).
// The D2 extraction stage produces a validated CaseDocument; these rules run
// BEFORE any LLM narrative so findings are grounded in extracted fields.
// Rule codes are stable — the frontend maps them to plain-English copy.

export type FindingSeverity = "high" | "medium" | "info";

export type FindingCode =
  | "DUPLICATE_LINE_ITEM"
  | "EOB_BILL_MISMATCH"
  | "MISSING_ITEMIZATION"
  | "BALANCE_BILLING_SIGNAL"
  | "DENIAL_WITHOUT_REASON"
  | "UPCODING_SIGNAL";

export interface Finding {
  code: FindingCode;
  severity: FindingSeverity;
  title: string;
  /** Plain-English explanation referencing concrete document spans/lines. */
  detail: string;
  /** Document line references, e.g. ["line 4", "line 7"]. */
  spans: string[];
}

/** Minimal line-item shape the D2 extractor will produce. */
export interface BillLineItem {
  lineRef: string;
  description: string;
  code?: string;
  amountCents: number;
}

export interface CaseDocumentInput {
  lineItems: BillLineItem[];
  patientResponsibilityCents: number | null;
  eobPatientResponsibilityCents: number | null;
  denialReason: string | null;
  isItemized: boolean;
}

/**
 * Run deterministic checks over extracted document data.
 * D2 will implement each rule; this scaffold returns no findings so the
 * pipeline shape is testable end to end.
 */
export function detectRedFlags(_doc: CaseDocumentInput): Finding[] {
  // TODO(D2): implement DUPLICATE_LINE_ITEM, EOB_BILL_MISMATCH,
  // MISSING_ITEMIZATION, BALANCE_BILLING_SIGNAL, DENIAL_WITHOUT_REASON,
  // UPCODING_SIGNAL.
  return [];
}
