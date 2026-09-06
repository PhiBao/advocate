// Document extraction: bill/EOB/denial -> validated CaseExtraction JSON.
// Two input paths:
// - Images (photo of a bill): vision extraction, data URL passed straight
//   to the model. Covers the primary mobile flow.
// - PDFs: text is pulled out with unpdf (serverless PDF.js). Digital PDFs
//   (statements, EOBs) extract cleanly; scanned PDFs with no text layer raise
//   ScannedPdfError and the pipeline degrades to an honest "send photos"
//   message instead of hallucinating.
//
// The guard is strict on purpose: the letter generator (D4) may only cite
// fields present in a validated extraction.

import { extractText, getDocumentProxy } from "unpdf";
import { LlmError, type Guard, type LlmClient } from "./llm";

export type DocumentKind = "bill" | "eob" | "denial" | "unknown";

export interface ExtractedLineItem {
  lineRef: string;
  description: string;
  code: string | null;
  amountCents: number;
}

export interface CaseExtraction {
  documentKind: DocumentKind;
  providerName: string | null;
  payerName: string | null;
  /** YYYY-MM-DD when printed, else null. */
  statementDate: string | null;
  totalBilledCents: number | null;
  insurerPaidCents: number | null;
  patientResponsibilityCents: number | null;
  /**
   * Amounts the plan says it does NOT cover ("not covered", "plan does not
   * cover", ineligible). Distinct from deductible/coinsurance cost-sharing.
   */
  notCoveredCents: number | null;
  /** Amounts applied to deductible ("applied to deductible", "deductible"). */
  deductibleAppliedCents: number | null;
  denialReason: string | null;
  lineItems: ExtractedLineItem[];
  /** 0..1 — extractor's self-reported confidence in the transcription. */
  confidence: number;
}

export class ScannedPdfError extends Error {
  constructor() {
    super("This PDF has no readable text layer (likely a scan).");
    this.name = "ScannedPdfError";
  }
}

export class UnsupportedDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedDocumentError";
  }
}

const MAX_VISION_BYTES = 10_485_760;
const MAX_PDF_TEXT_CHARS = 30_000;
const MIN_PDF_TEXT_CHARS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new Error("expected string|null");
  const s = v.trim();
  return s === "" ? null : s;
}

function optDollarsToCents(v: unknown, field: string): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`expected number|null for ${field}`);
  }
  return Math.round(v * 100);
}

export const guardExtraction: Guard<CaseExtraction> = (value: unknown) => {
  if (!isRecord(value)) throw new Error("extraction must be an object");
  const kind = value["documentKind"];
  if (kind !== "bill" && kind !== "eob" && kind !== "denial" && kind !== "unknown") {
    throw new Error("invalid documentKind");
  }
  const rawItems = value["lineItems"];
  if (!Array.isArray(rawItems)) throw new Error("lineItems must be an array");
  const lineItems: ExtractedLineItem[] = rawItems.map((raw, i) => {
    if (!isRecord(raw)) throw new Error(`lineItems[${i}] must be an object`);
    const lineRef = optString(raw["lineRef"]) ?? `line ${i + 1}`;
    const description = optString(raw["description"]);
    if (!description) throw new Error(`lineItems[${i}].description is required`);
    const code = optString(raw["code"]);
    const amountCents = optDollarsToCents(raw["amount"], `lineItems[${i}].amount`);
    if (amountCents === null) throw new Error(`lineItems[${i}].amount is required`);
    return { lineRef, description, code, amountCents };
  });
  const confidence = value["confidence"];
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) {
    throw new Error("confidence must be a number between 0 and 1");
  }
  return {
    documentKind: kind,
    providerName: optString(value["providerName"]),
    payerName: optString(value["payerName"]),
    statementDate: optString(value["statementDate"]),
    totalBilledCents: optDollarsToCents(value["totalBilled"], "totalBilled"),
    insurerPaidCents: optDollarsToCents(value["insurerPaid"], "insurerPaid"),
    patientResponsibilityCents: optDollarsToCents(
      value["patientResponsibility"],
      "patientResponsibility",
    ),
    notCoveredCents: optDollarsToCents(value["notCovered"], "notCovered"),
    deductibleAppliedCents: optDollarsToCents(value["deductibleApplied"], "deductibleApplied"),
    denialReason: optString(value["denialReason"]),
    lineItems,
    confidence,
  };
};

const SYSTEM = `You transcribe US medical billing documents (patient statements, explanations of benefits, denial letters) into structured data.

Rules:
- Transcribe ONLY values printed in the document. Never infer, compute, or round.
- List every charge line separately, even exact duplicates — duplicates matter.
- Use null for anything not printed. Do not guess the document kind: use "unknown" if unsure.
- Amounts are plain numbers in dollars (e.g. 1840.00, -2150.00 for payments/credits).
- insurerPaid is the amount the insurer paid: ALWAYS zero or positive. A credit line like "Insurance paid: -$2,150" means the insurer covered $2,150 — record 2150.00, never negative.
- lineRef is where the line appears, e.g. "line 4" or "page 2, line 3".
- denialReason is ONLY the insurer's stated explanation for not paying (e.g. "no prior authorization on file"). A bare "DENIED" or "STATUS: DENIED" with no explanation is NOT a reason — use null.
- Respond with a single JSON object and nothing else, matching this shape:
{"documentKind":"bill|eob|denial|unknown","providerName":string|null,"payerName":string|null,"statementDate":"YYYY-MM-DD"|null,"totalBilled":number|null,"insurerPaid":number|null,"patientResponsibility":number|null,"notCovered":number|null,"deductibleApplied":number|null,"denialReason":string|null,"lineItems":[{"lineRef":string,"description":string,"code":string|null,"amount":number}],"confidence":0.0-1.0}`;

const EOB_HINT = `For an explanation of benefits: patientResponsibility is "what you owe" / "total member responsibility" / "amount you owe". totalBilled is provider charges / billed amount. insurerPaid is "plan paid" / "paid by insurer". notCovered is ONLY amounts explicitly labeled "not covered" / "plan does not cover" / "ineligible" — never deductible, copay, or coinsurance amounts. deductibleApplied is ONLY amounts labeled "applied to deductible" / "deductible". When in doubt, use null.`;

async function extractWithVision(
  client: LlmClient,
  bytes: Uint8Array,
  contentType: string,
): Promise<CaseExtraction> {
  if (bytes.byteLength > MAX_VISION_BYTES) {
    throw new UnsupportedDocumentError(
      "That photo is too large to read. Please retake it at a lower resolution.",
    );
  }
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
  return client.completeJson({
    system: `${SYSTEM}\n\n${EOB_HINT}`,
    user: "Transcribe the attached medical billing document.",
    images: [dataUrl],
    guard: guardExtraction,
    maxTokens: 4096,
  });
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  let proxy: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    proxy = await getDocumentProxy(bytes);
  } catch {
    throw new LlmError("Could not parse that PDF.", false);
  }
  const { text } = await extractText(proxy, { mergePages: true });
  const cleaned = text.replace(/[ \t]+\n/g, "\n").trim();
  if (cleaned.length < MIN_PDF_TEXT_CHARS) throw new ScannedPdfError();
  return cleaned.length > MAX_PDF_TEXT_CHARS
    ? `${cleaned.slice(0, MAX_PDF_TEXT_CHARS)}\n[…truncated…]`
    : cleaned;
}

async function extractWithText(client: LlmClient, text: string): Promise<CaseExtraction> {
  return client.completeJson({
    system: `${SYSTEM}\n\n${EOB_HINT}\n\nYou are given the document's extracted text with page breaks marked.`,
    user: `Transcribe this medical billing document:\n\n${text}`,
    guard: guardExtraction,
    maxTokens: 4096,
  });
}

/** Extract one uploaded document. Throws ScannedPdfError / LlmError on failure. */
export async function extractDocument(
  client: LlmClient,
  bytes: Uint8Array,
  contentType: string,
): Promise<CaseExtraction> {
  if (contentType === "application/pdf") {
    const text = await extractPdfText(bytes);
    return extractWithText(client, text);
  }
  return extractWithVision(client, bytes, contentType);
}
