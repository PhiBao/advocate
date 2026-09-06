// D3: guided intake Q&A + case summary + deterministic explainer.
// Grounding rule: question/summary generation receives ONLY validated
// extraction JSON + deterministic findings. Answers are user-supplied facts.
// The summary's evidence bullets must reference finding spans or line refs —
// enforced by the guard, so D4's letter can cite them.

import type { CaseExtraction } from "./extract";
import type { Guard, LlmClient } from "./llm";

export type QuestionKind = "yes_no" | "single_choice" | "short_text";

export interface IntakeQuestion {
  key: string;
  prompt: string;
  kind: QuestionKind;
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`invalid ${field}`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${field} too long`);
  return s;
}

const QUESTION_SYSTEM = `You help a patient advocate interview a user about a medical bill or denial. Given the transcribed document and the automated findings, write at most 6 short, plain-English questions whose answers determine the appeal strategy.

Rules:
- Every question must be answerable by a non-expert patient in seconds.
- Prefer yes_no, then single_choice (2-4 short options), then short_text.
- Ask about: whether flagged services were actually received (and how many times), emergency vs scheduled care, in-network facility, prior authorization, payments already made, and deadlines printed on the document.
- Reference concrete values from the document (amounts, dates, codes) inside each prompt so the user knows exactly what you mean.
- Never ask for SSN, full DOB, insurance ID numbers, or anything we don't need.
- Keys are stable snake_case ids.
- Respond with a single JSON object and nothing else:
{"questions":[{"key":string,"prompt":string,"kind":"yes_no|single_choice|short_text","options":string[]}]}`;

export const guardQuestions: Guard<IntakeQuestion[]> = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value["questions"])) {
    throw new Error("questions must be an array");
  }
  const raw = value["questions"];
  if (raw.length === 0 || raw.length > 6) throw new Error("expected 1-6 questions");
  return raw.map((q, i) => {
    if (!isRecord(q)) throw new Error(`questions[${i}] must be an object`);
    const kind = q["kind"];
    if (kind !== "yes_no" && kind !== "single_choice" && kind !== "short_text") {
      throw new Error(`questions[${i}].kind invalid`);
    }
    const options =
      kind === "single_choice"
        ? (() => {
            if (!Array.isArray(q["options"])) throw new Error(`questions[${i}].options invalid`);
            const opts = q["options"].map((o) => str(o, `questions[${i}].options`, 60));
            if (opts.length < 2 || opts.length > 4) throw new Error("expected 2-4 options");
            return opts;
          })()
        : [];
    return {
      key: str(q["key"], `questions[${i}].key`, 40)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_"),
      prompt: str(q["prompt"], `questions[${i}].prompt`, 280),
      kind,
      options,
      answer: null,
    };
  });
};

const SUMMARY_SYSTEM = `You are a patient advocate writing a case brief from a transcribed medical bill, automated findings, and the patient's answers. Write for a non-expert: short sentences, no jargon, no invented facts.

Rules:
- disputeLabel: one line naming the dispute, e.g. "Possible duplicate emergency-room charge".
- deadlineText: appeal timing in general terms (most plans allow ~180 days; the exact deadline is on the EOB/letter). Never invent a specific date.
- strategy: 2-4 sentences on what to dispute and why, grounded ONLY in the findings and answers.
- evidence: 2-5 bullets, each referencing a concrete document span or line (e.g. "lines 3-4 show the same $1,840 charge twice"). No bullet without a span.
- nextStep: the single most useful next action.
- This is advocacy assistance, not legal advice. Do not cite statutes by number.
- Respond with a single JSON object and nothing else:
{"disputeLabel":string,"deadlineText":string,"strategy":string,"evidence":string[],"nextStep":string}`;

export const guardSummary: Guard<CaseSummary> = (value: unknown) => {
  if (!isRecord(value)) throw new Error("summary must be an object");
  const evidence = value["evidence"];
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 5) {
    throw new Error("evidence must have 1-5 bullets");
  }
  return {
    disputeLabel: str(value["disputeLabel"], "disputeLabel", 140),
    deadlineText: str(value["deadlineText"], "deadlineText", 400),
    strategy: str(value["strategy"], "strategy", 900),
    evidence: evidence.map((e, i) => str(e, `evidence[${i}]`, 300)),
    nextStep: str(value["nextStep"], "nextStep", 300),
  };
};

export interface Grounding {
  extractions: CaseExtraction[];
  findings: Array<{ code: string; title: string; detail: string }>;
}

function groundingText(g: Grounding): string {
  return JSON.stringify(
    {
      extractions: g.extractions,
      findings: g.findings.map((f) => ({ code: f.code, title: f.title, detail: f.detail })),
    },
    null,
    1,
  ).slice(0, 12_000);
}

export async function generateQuestions(client: LlmClient, g: Grounding): Promise<IntakeQuestion[]> {
  return client.completeJson({
    system: QUESTION_SYSTEM,
    user: `Document transcription + findings:\n\n${groundingText(g)}`,
    guard: guardQuestions,
    maxTokens: 1500,
  });
}

export async function generateSummary(
  client: LlmClient,
  g: Grounding,
  answers: Array<{ prompt: string; answer: string }>,
): Promise<CaseSummary> {
  const qa = answers.map((a) => `Q: ${a.prompt}\nA: ${a.answer}`).join("\n\n").slice(0, 4000);
  return client.completeJson({
    system: SUMMARY_SYSTEM,
    user: `Document transcription + findings:\n\n${groundingText(g)}\n\nPatient answers:\n\n${qa}`,
    guard: guardSummary,
    maxTokens: 1500,
  });
}

// --- Deterministic explainer: pure function of validated data, zero model risk. ---

export interface ExplainerLine {
  description: string;
  amountCents: number;
}

export interface Explainer {
  providerName: string | null;
  payerName: string | null;
  documentKind: string;
  totalBilledCents: number | null;
  insurerPaidCents: number | null;
  patientResponsibilityCents: number | null;
  lines: ExplainerLine[];
}

/** Build the "what this bill says" card. Null when nothing was extracted yet. */
export function buildExplainer(extractions: CaseExtraction[]): Explainer | null {
  if (extractions.length === 0) return null;
  const first = extractions[0]!;
  const lines: ExplainerLine[] = [];
  for (const ext of extractions) {
    for (const item of ext.lineItems.slice(0, 20)) {
      lines.push({ description: item.description, amountCents: item.amountCents });
    }
  }
  const pick = (f: (e: CaseExtraction) => number | null): number | null => {
    for (const e of extractions) {
      const v = f(e);
      if (v !== null) return v;
    }
    return null;
  };
  return {
    providerName: first.providerName,
    payerName: first.payerName,
    documentKind: first.documentKind,
    totalBilledCents: pick((e) => e.totalBilledCents),
    insurerPaidCents: pick((e) => e.insurerPaidCents),
    patientResponsibilityCents: pick((e) => e.patientResponsibilityCents),
    lines,
  };
}
