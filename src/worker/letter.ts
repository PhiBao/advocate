// D4: appeal letter drafting with citation verification.
// Trust rule: every dollar amount and every line reference in the letter must
// resolve to the validated extraction. Anything unverifiable blocks approval.
// Personal details we don't have stay as [BRACKETED] placeholders for the
// user to fill — never invented.

import type { CaseExtraction } from "./extract";
import type { Guard, LlmClient } from "./llm";

export interface LetterCitation {
  span: string;
  quote: string;
}

export interface DraftLetter {
  subject: string;
  bodyMd: string;
  citations: LetterCitation[];
}

export type LetterStatus = "draft" | "approved" | "needs_review";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "") throw new Error(`invalid ${field}`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${field} too long`);
  return s;
}

const LETTER_SYSTEM = `You write a formal health-insurance appeal / billing-dispute letter for a patient to send. Plain, firm, polite. Short paragraphs.

Structure the body in markdown:
[YOUR NAME]
[YOUR ADDRESS]
[DATE]

Appeals Department
[PAYER NAME — prefilled below if known]

Re: <subject>

Dear Appeals Team,

Paragraph 1: who you are and what this letter disputes (service, date, amount), using ONLY the facts given.
Paragraph 2: what is wrong, citing the evidence lines given (reference them as "line 3", "lines 3-4", etc.).
Paragraph 3: what you request (reprocess the claim / remove the charge / provide a written explanation), plus a 180-day appeal-rights reminder to yourself is unnecessary — keep it to the request and a 30-day response ask.

Sincerely,
[YOUR NAME]
Member ID: [MEMBER ID]
Claim: [CLAIM NUMBER]

Enclosures: copy of the bill/EOB, (anything else relevant)

Rules:
- Use ONLY the facts provided. Never invent names, addresses, IDs, dates of service, or amounts.
- Unknown personal details stay as [BRACKETED] placeholders.
- Every dollar amount and every line reference MUST come from the evidence given.
- State payment facts ONLY as the patient answered them. If the answers say no payment was made, never claim any payment was made.
- Never quote finding titles or strategy text as if they were printed in the document. Cite the underlying lines and amounts instead.
- Never assert a date of service unless one is printed in the facts.
- Format dollar amounts with commas: $2,400, not $2400.
- Also return citations: 2-6 items, each {span, quote} where span is a DOCUMENT line reference like "line 3" or "lines 3-4" (never "strategy", "evidence", or anything else), and quote is the exact fact cited.
- The valid line references are listed in the facts as validLineReferences. Cite ONLY those.
- Respond with a single JSON object and nothing else:
{"subject":string,"bodyMd":string,"citations":[{"span":string,"quote":string}]}`;

export const guardLetter: Guard<DraftLetter> = (value: unknown) => {
  if (!isRecord(value)) throw new Error("letter must be an object");
  const rawCites = value["citations"];
  if (!Array.isArray(rawCites) || rawCites.length < 2 || rawCites.length > 6) {
    throw new Error("citations must have 2-6 items");
  }
  return {
    subject: str(value["subject"], "subject", 140),
    bodyMd: str(value["bodyMd"], "bodyMd", 4000),
    citations: rawCites.map((c, i) => {
      if (!isRecord(c)) throw new Error(`citations[${i}] must be an object`);
      return { span: str(c["span"], `citations[${i}].span`, 40), quote: str(c["quote"], `citations[${i}].quote`, 200) };
    }),
  };
};

export interface LetterGrounding {
  extractions: CaseExtraction[];
  disputeLabel: string;
  strategy: string;
  evidence: string[];
  answers: Array<{ prompt: string; answer: string }>;
}

function groundingText(g: LetterGrounding): string {
  const d = (cents: number | null): number | null => (cents === null ? null : Math.round(cents) / 100);
  const validRefs = [
    ...new Set(
      g.extractions.flatMap((e) =>
        e.lineItems.map((i) => {
          const m = /line\s+(\d+)/i.exec(i.lineRef);
          return m?.[1] ? `line ${Number.parseInt(m[1], 10)}` : null;
        }),
      ).filter((r): r is string => r !== null),
    ),
  ];
  const view = {
    dispute: g.disputeLabel,
    strategy: g.strategy,
    evidence: g.evidence,
    patientAnswers: g.answers,
    validLineReferences: validRefs.length > 0 ? validRefs : ["(no itemized lines — cite totals only)"],
    documents: g.extractions.map((e) => ({
      kind: e.documentKind,
      provider: e.providerName,
      payer: e.payerName,
      statementDate: e.statementDate,
      totalBilled: d(e.totalBilledCents),
      insurerPaid: d(e.insurerPaidCents),
      patientResponsibility: d(e.patientResponsibilityCents),
      notCovered: d(e.notCoveredCents),
      denialReason: e.denialReason,
      lines: e.lineItems.map((i) => ({ ref: i.lineRef, desc: i.description, code: i.code, amount: d(i.amountCents) })),
    })),
  };
  return JSON.stringify(view, null, 1).slice(0, 12_000);
}

export async function draftLetter(client: LlmClient, g: LetterGrounding, repairNote?: string): Promise<DraftLetter> {
  const user = repairNote
    ? `Rewrite the letter. Fix ONLY these problems (everything else stays grounded):\n${repairNote}\n\nFacts:\n\n${groundingText(g)}`
    : `Write the appeal letter from these facts:\n\n${groundingText(g)}`;
  return client.completeJson({
    system: `${LETTER_SYSTEM}\n\nAll money figures in the input are in dollars. Quote them exactly as given.`,
    user,
    guard: guardLetter,
    maxTokens: 2500,
  });
}

// --- Citation verification (pure, deterministic) ---

export interface CheckIssue {
  kind: "amount" | "span";
  text: string;
}

function knownCents(extractions: CaseExtraction[]): Set<number> {
  const s = new Set<number>();
  const add = (v: number | null) => {
    if (v !== null) s.add(v);
  };
  for (const e of extractions) {
    add(e.totalBilledCents);
    add(e.insurerPaidCents);
    add(e.patientResponsibilityCents);
    add(e.notCoveredCents);
    add(e.deductibleAppliedCents);
    for (const i of e.lineItems) s.add(i.amountCents);
  }
  return s;
}

function knownLineRefs(extractions: CaseExtraction[]): Set<string> {
  const s = new Set<string>();
  for (const e of extractions) {
    for (const i of e.lineItems) {
      const m = /line\s+(\d+)/i.exec(i.lineRef);
      if (m?.[1]) s.add(m[1]);
    }
  }
  return s;
}

/**
 * Verify a draft body: every $ amount must match extracted amounts, every
 * "line N" reference must exist in the extraction. Returns issues found.
 */
export function checkBodyText(extractions: CaseExtraction[], bodyMd: string): CheckIssue[] {
  const issues: CheckIssue[] = [];
  const cents = knownCents(extractions);
  const refs = knownLineRefs(extractions);

  const amountRe = /\$[\d,]+(?:\.\d{1,2})?/g;
  const seen = new Set<string>();
  for (const m of bodyMd.match(amountRe) ?? []) {
    if (seen.has(m)) continue;
    seen.add(m);
    const value = Number.parseFloat(m.replace(/[$,]/g, ""));
    if (!Number.isFinite(value)) continue;
    if (!cents.has(Math.round(value * 100))) {
      issues.push({ kind: "amount", text: `${m} is not in your documents` });
    }
  }

  const spanRe = /\blines?\s+(\d+)(?:\s*[–-]\s*(\d+))?/gi;
  let sm: RegExpExecArray | null;
  const checkedRefs = new Set<string>();
  const checkRef = (n: string) => {
    if (checkedRefs.has(n)) return;
    checkedRefs.add(n);
    if (!refs.has(String(Number.parseInt(n, 10)))) {
      issues.push({ kind: "span", text: `line ${n} is not in your documents` });
    }
  };
  while ((sm = spanRe.exec(bodyMd)) !== null) {
    checkRef(sm[1]!);
    if (sm[2]) {
      const a = Number.parseInt(sm[1]!, 10);
      const b = Number.parseInt(sm[2], 10);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) checkRef(String(n));
    }
  }
  return issues;
}

/**
 * Prune citations whose spans don't resolve to extracted lines. Citations are
 * our audit trail, not user-sent text: dropping an unverifiable one is honest
 * (we only display verified refs), while body problems still block approval.
 * Returns the pruned list plus the dropped span names for the repair note.
 */
export function pruneCitations(
  extractions: CaseExtraction[],
  citations: LetterCitation[],
): { kept: LetterCitation[]; dropped: string[] } {
  const refs = knownLineRefs(extractions);
  const kept: LetterCitation[] = [];
  const dropped: string[] = [];
  for (const c of citations) {
    const m = /line\s+(\d+)/i.exec(c.span);
    if (m?.[1] && !refs.has(String(Number.parseInt(m[1], 10)))) {
      dropped.push(c.span);
      continue;
    }
    kept.push(c);
  }
  return { kept, dropped };
}

export function repairNoteFor(issues: CheckIssue[]): string {
  return issues.map((i) => `- ${i.text}; remove it or replace with a verified fact`).join("\n");
}

// --- Semantic verifier (second model pass): catches what regexes can't,
// e.g. invented payments, quoted finding-titles, asserted dates. ---

const VERIFIER_SYSTEM = `You audit a patient appeal letter against the case facts (transcribed documents, findings, patient answers). List MATERIAL problems only — false alarms block a good letter from being approved, which hurts the patient.

AUDIT ONLY factual assertions about the case. IGNORE all of the following — never list them as problems:
- [BRACKETED] placeholders ([YOUR NAME], [DATE OF SERVICE], [CLAIM NUMBER]…): these are fill-in blanks, not claims.
- Requests and asks ("I request reprocessing", "please respond within 30 days", "provide a written explanation"): these are what an appeal letter DOES, not factual claims.
- Accurate paraphrases: "the denial gives no clear reason" is fine when the facts show no reason, even without a verbatim quote.
- Salutations, closings, enclosure lists, subject lines.

FLAG ONLY:
- invented or wrong dollar amounts, codes, names, dates presented as fact
- payment claims contradicting or going beyond the patient's answers
- service details (emergency vs scheduled, in-network, received or not) contradicting the answers
- fabricated document quotes (quotation marks around text not in the facts)

Respond with a single JSON object and nothing else: {"problems": string[]}
Empty array means clean. At most 5 problems, each naming the exact offending sentence.`;

export const guardVerifier: Guard<{ problems: string[] }> = (value: unknown) => {
  if (!isRecord(value) || !Array.isArray(value["problems"])) {
    throw new Error("problems must be an array");
  }
  if (value["problems"].length > 5) throw new Error("too many problems");
  return {
    problems: value["problems"].map((p, i) => str(p, `problems[${i}]`, 250)),
  };
};

export async function verifyLetter(
  client: LlmClient,
  g: LetterGrounding,
  draft: DraftLetter,
): Promise<string[]> {
  const res = await client.completeJson({
    system: VERIFIER_SYSTEM,
    user: `Case facts:\n\n${groundingText(g)}\n\nLetter to audit:\n\nSubject: ${draft.subject}\n\n${draft.bodyMd}`,
    guard: guardVerifier,
    maxTokens: 800,
  });
  return res.problems;
}
