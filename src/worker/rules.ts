// Deterministic red-flag rules over validated extractions.
// These run BEFORE any LLM narrative so findings are grounded in extracted
// fields, never in model vibes. Rule codes are stable — the frontend maps
// them to plain-English copy. Wording stays careful: flags are leads for the
// appeal, not accusations.

import type { CaseExtraction } from "./extract";

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

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** Duplicate exact charges: same code + amount, or same description + amount. */
function duplicateRule(doc: CaseExtraction): Finding[] {
  const groups = new Map<string, { label: string; refs: string[] }>();
  for (const item of doc.lineItems) {
    const key =
      item.code !== null
        ? `code:${normalize(item.code)}|${item.amountCents}`
        : `desc:${normalize(item.description)}|${item.amountCents}`;
    const g = groups.get(key) ?? { label: item.description, refs: [] };
    g.refs.push(item.lineRef);
    groups.set(key, g);
  }
  const out: Finding[] = [];
  for (const g of groups.values()) {
    if (g.refs.length >= 2) {
      out.push({
        code: "DUPLICATE_LINE_ITEM",
        severity: "high",
        title: `Possible duplicate charge: ${g.label}`,
        detail:
          `The same charge appears ${g.refs.length} times (${g.refs.join(", ")}). ` +
          `Providers sometimes bill twice for one service by mistake — this is worth disputing unless you received the service that many times.`,
        spans: g.refs,
      });
    }
  }
  return out;
}

/** Bill vs EOB totals disagree across documents in the same case. */
export function mismatchRule(
  bills: CaseExtraction[],
  eobs: CaseExtraction[],
): Finding[] {
  const billTotals = bills
    .map((b) => b.patientResponsibilityCents)
    .filter((v): v is number => v !== null);
  const eobTotals = eobs
    .map((e) => e.patientResponsibilityCents)
    .filter((v): v is number => v !== null);
  if (billTotals.length === 0 || eobTotals.length === 0) return [];
  const bill = Math.max(...billTotals);
  const eob = Math.max(...eobTotals);
  if (Math.abs(bill - eob) <= 100) return [];
  return [
    {
      code: "EOB_BILL_MISMATCH",
      severity: "high",
      title: "Your bill and your EOB disagree",
      detail:
        `Your bill says you owe ${dollars(bill)}, but your explanation of benefits says ` +
        `${dollars(eob)}. You generally owe what the EOB says — never pay a bill that is higher without asking why.`,
      spans: [],
    },
  ];
}

function itemizationRule(doc: CaseExtraction): Finding[] {
  if (doc.lineItems.length > 0) return [];
  if (doc.totalBilledCents === null && doc.patientResponsibilityCents === null) {
    return [
      {
        code: "MISSING_ITEMIZATION",
        severity: "info",
        title: "Couldn't find an itemized breakdown",
        detail:
          "This document doesn't show individual charges, so there's nothing to check line by line yet. An itemized statement (not a summary) is what you want before paying or appealing.",
        spans: [],
      },
    ];
  }
  return [
    {
      code: "MISSING_ITEMIZATION",
      severity: "medium",
      title: "No itemized charges found",
      detail:
        `The document shows ${doc.totalBilledCents !== null ? dollars(doc.totalBilledCents) : "a total"} billed but no line-by-line breakdown. ` +
        `You have the right to request an itemized statement — errors hide in summaries.`,
      spans: [],
    },
  ];
}

const OON_PATTERN = /out.of.network|\boon\b|non.?participating|balance.bill/i;

function balanceBillingRule(doc: CaseExtraction): Finding[] {
  const hits = doc.lineItems.filter(
    (i) => OON_PATTERN.test(i.description) && i.amountCents > 0,
  );
  const deniedOon =
    doc.denialReason !== null && OON_PATTERN.test(doc.denialReason);
  if (hits.length === 0 && !deniedOon) return [];
  const refs = hits.map((h) => h.lineRef);
  return [
    {
      code: "BALANCE_BILLING_SIGNAL",
      severity: "medium",
      title: "Possible out-of-network / balance billing",
      detail:
        `This document mentions out-of-network care${refs.length > 0 ? ` (${refs.join(", ")})` : ""}. ` +
        `Federal No Surprises Act protections cover many surprise out-of-network bills from ER visits and in-network facilities — check whether this bill is one you legally have to pay in full.`,
      spans: refs,
    },
  ];
}

/** Boilerplate that extractors sometimes put in denialReason ("STATUS DENIED", "N/A"). Not a reason. */
const BOILERPLATE_REASON =
  /^(status[:\s]*denied|denied|n\/?a|none(\s+stated|\s+given)?|not\s+stated|unknown|see\s+above|no\s+reason(\s+given)?)$/i;

function hasRealReason(reason: string | null): boolean {
  if (reason === null) return false;
  return !BOILERPLATE_REASON.test(reason.trim());
}

function denialRule(doc: CaseExtraction): Finding[] {
  if (hasRealReason(doc.denialReason)) return [];
  // A bare denial letter with no reason: the insurer owes a written explanation.
  if (doc.documentKind === "denial") {
    return [
      {
        code: "DENIAL_WITHOUT_REASON",
        severity: "high",
        title: "Denied with no clear reason given",
        detail:
          "This denial states no usable reason. Insurers must provide a specific reason on request — a missing reason is itself grounds to appeal and ask for a written explanation.",
        spans: [],
      },
    ];
  }
  // Covered vs. not-covered is the distinction that matters: amounts applied
  // to a deductible are normal cost-sharing, NOT a denial. Only fire when the
  // plan explicitly labels amounts as not covered and gives no reason.
  if (doc.notCoveredCents !== null && doc.notCoveredCents > 0) {
    return [
      {
        code: "DENIAL_WITHOUT_REASON",
        severity: "high",
        title: "Part of your claim wasn't covered — no reason given",
        detail:
          `The plan marked ${dollars(doc.notCoveredCents)} as not covered without stating why. ` +
          `That portion is appealable: ask for the specific exclusion or reason code in writing.`,
        spans: [],
      },
    ];
  }
  return [];
}

// Office/outpatient E/M ranges where stacking distinct codes is suspicious.
const EM_RANGES: Array<[number, number]> = [
  [99202, 99205],
  [99211, 99215],
  [99221, 99223],
  [99231, 99233],
  [99281, 99285],
];

function upcodingRule(doc: CaseExtraction): Finding[] {
  const emCodes = new Set<string>();
  for (const item of doc.lineItems) {
    if (item.code === null) continue;
    const n = Number.parseInt(item.code, 10);
    if (!Number.isFinite(n)) continue;
    if (EM_RANGES.some(([lo, hi]) => n >= lo && n <= hi)) emCodes.add(item.code);
  }
  if (emCodes.size < 2) return [];
  return [
    {
      code: "UPCODING_SIGNAL",
      severity: "info",
      title: "Multiple evaluation codes on one visit",
      detail:
        `This document lists several evaluation-and-management codes (${[...emCodes].join(", ")}). ` +
        `That can be legitimate, but it's also how upcoding shows up — worth one question to the provider's billing office.`,
      spans: [],
    },
  ];
}

/** Run all single-document rules. Cross-document mismatch runs separately. */
export function detectRedFlags(doc: CaseExtraction): Finding[] {
  return [
    ...duplicateRule(doc),
    ...itemizationRule(doc),
    ...balanceBillingRule(doc),
    ...denialRule(doc),
    ...upcodingRule(doc),
  ];
}
