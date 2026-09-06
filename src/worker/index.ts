// Advocate API (Cloudflare Worker, Hono).
// v1 routes:
//   GET  /api/health
//   POST /api/cases            (multipart: file, disputeType?) -> case + claim token
//   GET  /api/cases/:id?token= (passwordless case view via signed claim token)
//
// Security notes:
// - Uploads are validated three ways: declared content-type allowlist,
//   magic-byte sniffing, and a byte-size cap. Document bytes are untrusted
//   data and are NEVER interpolated into prompts (D2 pipeline rule).
// - No auth sessions: case reads require a signed, expiring claim token.
// - Errors return a fixed envelope; internal details are never leaked.

import { Hono } from "hono";
import {
  addDocument,
  addDelivery,
  addTimelineEvent,
  createCase,
  ensureQuestions,
  getCasePublic,
  getExtractions,
  getFindings,
  getLatestLetter,
  getQuestions,
  getSummary,
  saveAnswers,
  saveLetterVersion,
  saveOutcome,
  saveSummary,
  saveWtp,
  setCaseStatus,
  setLetterStatus,
} from "./db";
import { generateQuestions, generateSummary } from "./intake";
import {
  checkBodyText,
  draftLetter,
  pruneCitations,
  verifyLetter,
  type DraftLetter,
} from "./letter";
import { clientFromEnv } from "./llm";
import { processCase } from "./pipeline";
import { createClaimToken, verifyClaimToken } from "./tokens";
import { retentionSweep } from "./retention";
import type { DisputeType, Env } from "./types";
import { apiError } from "./types";

const app = new Hono<{ Bindings: Env }>();

const ALLOWED_TYPES: Record<string, { ext: string; magic: number[] }> = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  "image/webp": { ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] }, // RIFF....WEBP
};

const ALLOWED_DISPUTE_TYPES: DisputeType[] = ["medical_bill"];

// --- tiny fixed-window rate limiter (per-isolate; production hardens with DO) ---
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string, limit: number, windowMs: number): boolean {
  const t = Date.now();
  const cur = hits.get(ip);
  if (!cur || cur.resetAt <= t) {
    hits.set(ip, { count: 1, resetAt: t + windowMs });
    return false;
  }
  cur.count += 1;
  return cur.count > limit;
}

function sniffMatches(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length + 4) return false;
  for (let i = 0; i < magic.length; i++) {
    const expected = magic[i];
    const actual = bytes[i];
    if (expected === undefined || actual !== expected) return false;
  }
  return true;
}

function sanitizeExt(filename: string, fallback: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename);
  if (!m?.[1]) return fallback;
  return m[1].toLowerCase();
}

app.get("/api/health", (c) => c.json({ ok: true, time: Date.now() }));

app.post("/api/cases", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (rateLimited(ip, 10, 60_000)) {
    return apiError("RATE_LIMITED", "Too many uploads. Please wait a minute and try again.", 429);
  }

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return apiError("BAD_UPLOAD", "Could not read the uploaded file. Please try again.");
  }

  const disputeTypeRaw = form.get("disputeType");
  const disputeType: DisputeType =
    typeof disputeTypeRaw === "string" &&
    (ALLOWED_DISPUTE_TYPES as string[]).includes(disputeTypeRaw)
      ? (disputeTypeRaw as DisputeType)
      : "medical_bill";

  const file = form.get("file");
  if (!(file instanceof File)) {
    return apiError("MISSING_FILE", "Attach a photo or PDF of your bill or denial letter to start.");
  }

  const declared = ALLOWED_TYPES[file.type];
  if (!declared) {
    return apiError(
      "UNSUPPORTED_TYPE",
      "Please upload a PDF, JPG, PNG, or WebP file (photos of paper bills work great).",
    );
  }

  const maxBytes = Number.parseInt(c.env.MAX_UPLOAD_BYTES, 10) || 15_728_640;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return apiError("EMPTY_FILE", "That file looks empty. Please try again.");
  }
  if (bytes.byteLength > maxBytes) {
    return apiError(
      "FILE_TOO_LARGE",
      `That file is ${(bytes.byteLength / 1_048_576).toFixed(1)} MB — please keep uploads under ${Math.floor(maxBytes / 1_048_576)} MB.`,
    );
  }
  if (!sniffMatches(bytes, declared.magic)) {
    return apiError(
      "FILE_MISMATCH",
      "That file doesn't look like the type it claims to be. Please upload the original photo or PDF.",
    );
  }

  const caseId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const objectKey = `cases/${caseId}/${docId}.${sanitizeExt(file.name, declared.ext)}`;

  const retentionDays = Number.parseInt(c.env.DATA_RETENTION_DAYS, 10) || 90;

  await createCase(c.env, { id: caseId, disputeType, retentionDays });
  await c.env.DOCS.put(objectKey, bytes, {
    httpMetadata: { contentType: file.type },
    customMetadata: { caseId },
  });
  await addDocument(c.env, {
    id: docId,
    caseId,
    objectKey,
    contentType: file.type,
    byteSize: bytes.byteLength,
  });
  await addTimelineEvent(c.env, {
    caseId,
    kind: "case_created",
    title: "Case opened",
    body: "Your advocate picked up the file. Reading starts next.",
  });
  await addTimelineEvent(c.env, {
    caseId,
    kind: "document_uploaded",
    title: "Bill received",
    body: `${Math.max(1, Math.round(bytes.byteLength / 1024))} KB · ${file.type}`,
  });
  await setCaseStatus(c.env, caseId, "reading");

  // Touch the per-case durable agent so D2+ can schedule reminders/deadlines.
  const stub = c.env.CASE_DO.get(c.env.CASE_DO.idFromName(caseId));
  await stub.fetch("https://do/reminders");

  // Extraction + findings run in the background; the case page polls for them.
  // waitUntil failures must never break the 201: processCase records its own
  // timeline events, so a case always leaves "reading" one way or another.
  c.executionCtx.waitUntil(processCase(c.env, caseId));

  const ttl = Number.parseInt(c.env.CLAIM_TOKEN_TTL_SECONDS, 10) || 7_776_000;
  const token = await createClaimToken(caseId, c.env.CLAIM_TOKEN_SECRET, ttl);

  return c.json({ caseId, claimToken: token, status: "reading" }, 201);
});

app.get("/api/cases/:id", async (c) => {
  const caseId = c.req.param("id");
  const token = c.req.query("token") ?? "";
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const kase = await getCasePublic(c.env, caseId);
  if (!kase) return apiError("NOT_FOUND", "We couldn't find that case.", 404);
  return c.json(kase);
});

function tokenFromBody(body: unknown): string {
  return typeof body === "object" && body !== null && "token" in body && typeof body.token === "string"
    ? body.token
    : "";
}

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

/** Generate (or return existing) intake questions. Idempotent — safe to retry. */
app.post("/api/cases/:id/questions", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const kase = await getCasePublic(c.env, caseId);
  if (!kase) return apiError("NOT_FOUND", "We couldn't find that case.", 404);

  const existing = await getQuestions(c.env, caseId);
  if (existing.length > 0) return c.json({ questions: existing });

  const extractions = await getExtractions(c.env, caseId);
  if (extractions.length === 0) {
    return apiError("NOT_READY", "We're still reading your documents. Try again in a moment.", 409);
  }
  try {
    const generated = await generateQuestions(clientFromEnv(c.env), {
      extractions,
      findings: await getFindings(c.env, caseId),
    });
    return c.json({ questions: await ensureQuestions(c.env, caseId, generated) });
  } catch {
    return apiError("TRY_AGAIN", "Question generation hiccuped. Please try again.", 503);
  }
});

/** Draft (or re-draft) the appeal letter with citation verification. */
async function buildLetter(
  env: Env,
  caseId: string,
): Promise<{ version: number; status: string; issues: string[] } | null> {
  const summary = await getSummary(env, caseId);
  if (!summary) return null;
  const extractions = await getExtractions(env, caseId);
  if (extractions.length === 0) return null;
  const questions = await getQuestions(env, caseId);
  const grounding = {
    extractions,
    disputeLabel: summary.disputeLabel,
    strategy: summary.strategy,
    evidence: summary.evidence,
    answers: questions
      .filter((q) => q.answer)
      .map((q) => ({ prompt: q.prompt, answer: q.answer as string })),
  };
  const client = clientFromEnv(env);
  const first = await draftLetter(client, grounding);
  const firstPrune = pruneCitations(extractions, first.citations);
  first.citations = firstPrune.kept;

  async function audit(draft: DraftLetter): Promise<string[]> {
    const det = checkBodyText(extractions, draft.bodyMd).map((i) => i.text);
    let sem: string[] = [];
    try {
      sem = await verifyLetter(client, grounding, draft);
    } catch {
      // Verifier failure is not approval: treat as one blocking problem.
      sem = ["independent verification unavailable — review carefully before approving"];
    }
    return [...det, ...sem];
  }

  let final: DraftLetter = first;
  let problems = await audit(first);
  if (problems.length > 0) {
    const droppedNote =
      firstPrune.dropped.length > 0
        ? `Do not cite these (not in the documents): ${firstPrune.dropped.join(", ")}. `
        : "";
    try {
      const repaired = await draftLetter(
        client,
        grounding,
        `${droppedNote}${problems.map((p) => `- ${p}`).join("\n")}`,
      );
      const repairedPrune = pruneCitations(extractions, repaired.citations);
      repaired.citations = repairedPrune.kept;
      const recheck = await audit(repaired);
      if (recheck.length === 0) {
        final = repaired;
        problems = [];
      } else {
        problems = recheck;
      }
    } catch {
      // Keep the first draft's problems; stored as needs_review below.
    }
  }
  // If a letter appeared while we were drafting (explicit POST raced the
  // background auto-draft), keep the newer one and drop ours.
  const raced = await getLatestLetter(env, caseId);
  if (raced) {
    return { version: raced.version, status: raced.status, issues: raced.issues };
  }
  const saved = await saveLetterVersion(env, caseId, final, problems.length === 0 ? "draft" : "needs_review", problems);
  await addTimelineEvent(env, {
    caseId,
    kind: "letter_ready",
    title: problems.length === 0 ? "Your appeal letter is ready to review" : "Your letter needs a second look",
    body:
      problems.length === 0
        ? "Review it below — nothing gets sent without your approval."
        : `We flagged ${problems.length} item${problems.length === 1 ? "" : "s"} we couldn't verify: ${problems.join("; ")}.`,
  });
  return { version: saved.version, status: saved.status, issues: problems };
}
app.post("/api/cases/:id/answers", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your answers.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }

  const rawAnswers =
    typeof body === "object" && body !== null && "answers" in body && Array.isArray(body.answers)
      ? body.answers
      : [];
  const stored = await getQuestions(c.env, caseId);
  if (stored.length === 0) return apiError("NOT_READY", "Answer the questions first.", 409);
  const byKey = new Map(stored.map((q) => [q.key, q]));

  const clean: Array<{ key: string; value: string }> = [];
  for (const a of rawAnswers) {
    if (typeof a !== "object" || a === null) return apiError("BAD_ANSWER", "Each answer needs a key and a value.");
    const { key, value } = a as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string") {
      return apiError("BAD_ANSWER", "Each answer needs a key and a value.");
    }
    const q = byKey.get(key);
    if (!q) return apiError("BAD_ANSWER", "Unknown question. Refresh and try again.");
    const v = value.trim();
    if (q.kind === "yes_no") {
      if (!/^(yes|no)$/i.test(v)) return apiError("BAD_ANSWER", "Please answer yes or no.");
      clean.push({ key, value: v.toLowerCase() === "yes" ? "Yes" : "No" });
    } else if (q.kind === "single_choice") {
      if (!q.options.includes(v)) return apiError("BAD_ANSWER", "Please pick one of the offered options.");
      clean.push({ key, value: v });
    } else {
      if (v.length === 0 || v.length > 500) {
        return apiError("BAD_ANSWER", "Please write a short answer (under 500 characters).");
      }
      clean.push({ key, value: v });
    }
  }
  if (clean.length > 0) await saveAnswers(c.env, caseId, clean);

  const updated = await getQuestions(c.env, caseId);
  const unanswered = updated.filter((q) => !q.answer);
  if (unanswered.length > 0) return c.json({ questions: updated, summary: null });

  // All answered (or re-POST with zero new answers): build/refresh the brief.
  const existing = await getSummary(c.env, caseId);
  if (existing && clean.length === 0) return c.json({ questions: updated, summary: existing });
  try {
    const summary = await generateSummary(
      clientFromEnv(c.env),
      {
        extractions: await getExtractions(c.env, caseId),
        findings: await getFindings(c.env, caseId),
      },
      updated.map((q) => ({ prompt: q.prompt, answer: q.answer ?? "" })),
    );
    await saveSummary(c.env, caseId, summary);
    await setCaseStatus(c.env, caseId, "ready_for_review");
    await addTimelineEvent(c.env, {
      caseId,
      kind: "note",
      title: "Case brief ready",
      body: summary.nextStep,
    });
    // Draft the appeal letter in the background; review screen polls for it.
    c.executionCtx.waitUntil(
      buildLetter(c.env, caseId).catch(() => null),
    );
    return c.json({ questions: updated, summary });
  } catch {
    return apiError("TRY_AGAIN", "The brief hiccuped. Tap build again in a moment.", 503);
  }
});

/** Generate the letter if missing, else return the latest version. Idempotent. */
app.post("/api/cases/:id/letter", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const latest = await getLatestLetter(c.env, caseId);
  if (latest) {
    const kase = await getCasePublic(c.env, caseId);
    return c.json({ letter: kase?.letter ?? null });
  }
  const summary = await getSummary(c.env, caseId);
  if (!summary) return apiError("NOT_READY", "Answer the questions first so we can draft your letter.", 409);
  try {
    await buildLetter(c.env, caseId);
  } catch {
    return apiError("TRY_AGAIN", "Drafting hiccuped. Please try again.", 503);
  }
  const kase = await getCasePublic(c.env, caseId);
  return c.json({ letter: kase?.letter ?? null });
});

/** Edit the letter body (creates a new version, re-verified). */
app.post("/api/cases/:id/letter/edit", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  if (typeof body !== "object" || body === null) return apiError("BAD_REQUEST", "Invalid body.");
  const { version, subject, bodyMd } = body as { version?: unknown; subject?: unknown; bodyMd?: unknown };
  if (typeof version !== "number" || typeof bodyMd !== "string") {
    return apiError("BAD_REQUEST", "Send the version number and the edited letter text.");
  }
  const latest = await getLatestLetter(c.env, caseId);
  if (!latest) return apiError("NOT_FOUND", "No letter to edit yet.", 404);
  if (latest.version !== version) {
    return apiError("STALE", "This letter changed. Refresh and edit the latest version.", 409);
  }
  if (latest.status === "approved") {
    return apiError("LOCKED", "This version is approved. Filing starts from it.", 409);
  }
  const text = bodyMd.trim();
  if (text.length < 50 || text.length > 5000) {
    return apiError("BAD_LETTER", "The letter looks too short or too long. Keep the structure.");
  }
  const extractions = await getExtractions(c.env, caseId);
  const draft: DraftLetter = {
    subject: typeof subject === "string" && subject.trim() ? subject.trim().slice(0, 140) : latest.subject,
    bodyMd: text,
    citations: pruneCitations(extractions, latest.citations).kept,
  };
  const problems = checkBodyText(extractions, draft.bodyMd).map((i) => i.text);
  try {
    const summary = await getSummary(c.env, caseId);
    if (summary) {
      const questions = await getQuestions(c.env, caseId);
      const sem = await verifyLetter(
        clientFromEnv(c.env),
        {
          extractions,
          disputeLabel: summary.disputeLabel,
          strategy: summary.strategy,
          evidence: summary.evidence,
          answers: questions
            .filter((q) => q.answer)
            .map((q) => ({ prompt: q.prompt, answer: q.answer as string })),
        },
        draft,
      );
      problems.push(...sem);
    }
  } catch {
    problems.push("independent verification unavailable — review carefully before approving");
  }
  const saved = await saveLetterVersion(c.env, caseId, draft, problems.length === 0 ? "draft" : "needs_review", problems);
  return c.json({
    letter: { ...saved, issues: problems },
  });
});

/** Approve a verified letter. Server-enforced gate: only clean drafts pass. */
app.post("/api/cases/:id/letter/approve", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const version =
    typeof body === "object" && body !== null && "version" in body ? body.version : undefined;
  const latest = await getLatestLetter(c.env, caseId);
  if (!latest) return apiError("NOT_FOUND", "No letter to approve yet.", 404);
  if (typeof version === "number" && version !== latest.version) {
    return apiError("STALE", "Approve the latest version.", 409);
  }
  if (latest.status === "needs_review") {
    return apiError("UNVERIFIED", "Fix the flagged items before approving.", 409);
  }
  if (latest.status === "approved") return c.json({ ok: true });
  await setLetterStatus(c.env, latest.id, "approved");
  await setCaseStatus(c.env, caseId, "approved");
  await addTimelineEvent(c.env, {
    caseId,
    kind: "letter_approved",
    title: "Letter approved",
    body: "Nothing has been sent — file it with the guide below whenever you're ready.",
  });
  return c.json({ ok: true });
});

const FILE_CHANNELS = ["portal", "mail", "fax", "phone", "in_person"] as const;

/** Record that the user filed the appeal. Starts the 21-day check-in loop. */
app.post("/api/cases/:id/filed", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const channel =
    typeof body === "object" && body !== null && "channel" in body ? body.channel : undefined;
  if (typeof channel !== "string" || !(FILE_CHANNELS as readonly string[]).includes(channel)) {
    return apiError("BAD_CHANNEL", "Tell us how you filed: portal, mail, fax, phone, or in person.");
  }
  const latest = await getLatestLetter(c.env, caseId);
  if (!latest || latest.status !== "approved") {
    return apiError("NOT_APPROVED", "Approve your letter first.", 409);
  }
  const note =
    typeof body === "object" && body !== null && "note" in body && typeof body.note === "string"
      ? body.note.slice(0, 500)
      : "";
  await addDelivery(c.env, { caseId, letterId: latest.id, channel, detail: note });
  await setCaseStatus(c.env, caseId, "filed");
  await addTimelineEvent(c.env, {
    caseId,
    kind: "filed",
    title: `Filed via ${channel.replace("_", " ")}`,
    body: "We'll check back in 3 weeks. If they respond sooner, record the outcome below.",
  });
  try {
    const stub = c.env.CASE_DO.get(c.env.CASE_DO.idFromName(caseId));
    await stub.fetch("https://do/reminders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reminder: {
          id: `followup-${latest.id}`,
          caseId,
          kind: "deadline_reminder",
          title: "Check on your appeal",
          body: "It's been 3 weeks since you filed. Any response? Record the outcome to close the loop.",
          fireAt: Date.now() + 21 * 86_400_000,
        },
      }),
    });
  } catch {
    // Reminder scheduling is best-effort; the filed state stands regardless.
  }
  return c.json({ ok: true });
});

const OUTCOME_RESULTS = ["won_full", "reduced", "denied", "no_response"] as const;

/** Record what happened. Closes the loop: resolved / closed / still tracking. */
app.post("/api/cases/:id/outcome", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  if (typeof body !== "object" || body === null) return apiError("BAD_REQUEST", "Invalid body.");
  const { result, amountRecovered, note } = body as {
    result?: unknown;
    amountRecovered?: unknown;
    note?: unknown;
  };
  if (typeof result !== "string" || !(OUTCOME_RESULTS as readonly string[]).includes(result)) {
    return apiError("BAD_OUTCOME", "Tell us what happened: won, reduced, denied, or waiting.");
  }
  const kase = await getCasePublic(c.env, caseId);
  if (!kase) return apiError("NOT_FOUND", "We couldn't find that case.", 404);
  if (!["filed", "in_followup", "resolved", "closed"].includes(kase.status)) {
    return apiError("TOO_EARLY", "File your appeal first — then record what happened.", 409);
  }
  let cents = 0;
  if (result === "won_full" || result === "reduced") {
    if (typeof amountRecovered !== "number" || !Number.isFinite(amountRecovered) || amountRecovered <= 0) {
      return apiError("BAD_AMOUNT", "Tell us how much you saved, in dollars.");
    }
    if (amountRecovered > 10_000_000) return apiError("BAD_AMOUNT", "That amount looks off. Check the number.");
    cents = Math.round(amountRecovered * 100);
  }
  const cleanNote = typeof note === "string" ? note.slice(0, 500) : "";

  await saveOutcome(c.env, {
    caseId,
    result: result as (typeof OUTCOME_RESULTS)[number],
    amountRecoveredCents: cents,
    note: cleanNote,
  });

  const nextStatus =
    result === "denied" ? "closed" : result === "no_response" ? "in_followup" : "resolved";
  await setCaseStatus(c.env, caseId, nextStatus);
  const titles = {
    won_full: "You won — full amount dropped",
    reduced: "Bill reduced",
    denied: "They said no — escalation options below",
    no_response: "Still no response — keep tracking",
  } as const;
  await addTimelineEvent(c.env, {
    caseId,
    kind: "outcome_recorded",
    title: titles[result as keyof typeof titles],
    ...(result === "won_full" || result === "reduced"
      ? { body: `Saved $${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}.${cleanNote ? ` ${cleanNote}` : ""}` }
      : cleanNote
        ? { body: cleanNote }
        : {}),
  });

  // Outcome recorded: the 3-week check-in has done its job.
  try {
    const latest = await getLatestLetter(c.env, caseId);
    if (latest) {
      const stub = c.env.CASE_DO.get(c.env.CASE_DO.idFromName(caseId));
      await stub.fetch("https://do/reminders/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: `followup-${latest.id}` }),
      });
    }
  } catch {
    // Best-effort; a stray reminder is harmless.
  }
  const updated = await getCasePublic(c.env, caseId);
  return c.json({ outcome: updated?.outcome ?? null, status: updated?.status ?? nextStatus });
});

const WTP_VALUES = ["yes", "if_wins", "no"] as const;

/** One-question WTP survey attached to a recorded outcome (validation metric). */
app.post("/api/cases/:id/outcome/wtp", async (c) => {
  const caseId = c.req.param("id");
  const body = await readJsonBody(c);
  if (!body) return apiError("BAD_REQUEST", "Send a JSON body with your case token.");
  const token = tokenFromBody(body);
  if (!token || !(await verifyClaimToken(token, caseId, c.env.CLAIM_TOKEN_SECRET))) {
    return apiError("FORBIDDEN", "This case link is missing, invalid, or expired.", 403);
  }
  const wtp = typeof body === "object" && body !== null ? (body as { wtp?: unknown }).wtp : undefined;
  if (typeof wtp !== "string" || !(WTP_VALUES as readonly string[]).includes(wtp)) {
    return apiError("BAD_WTP", "Answer yes, only if it wins, or no.");
  }
  const kase = await getCasePublic(c.env, caseId);
  if (!kase?.outcome) return apiError("NOT_FOUND", "Record the outcome first.", 404);
  await saveWtp(c.env, caseId, wtp as (typeof WTP_VALUES)[number]);
  return c.json({ ok: true });
});

app.onError((err, c) => {  // Never leak stack traces or binding details to clients.
  console.error("unhandled", err instanceof Error ? err.message : "unknown");
  return apiError("INTERNAL", "Something went wrong on our side. Please try again.", 500);
});

app.notFound((c) => apiError("NOT_FOUND", "Nothing here.", 404));

export default {
  fetch: app.fetch,
  // Daily retention sweep: enforce the 90-day auto-delete promise (privacy note).
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      retentionSweep(env).then((r) => {
        if (r.deleted > 0) console.log("retention sweep deleted", r.deleted, "cases");
      }),
    );
  },
} satisfies ExportedHandler<Env>;

export { CaseAgent } from "./CaseDO";
