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
import { addDocument, addTimelineEvent, createCase, getCasePublic, setCaseStatus } from "./db";
import { createClaimToken, verifyClaimToken } from "./tokens";
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

app.onError((err, c) => {
  // Never leak stack traces or binding details to clients.
  console.error("unhandled", err instanceof Error ? err.message : "unknown");
  return apiError("INTERNAL", "Something went wrong on our side. Please try again.", 500);
});

app.notFound((c) => apiError("NOT_FOUND", "Nothing here.", 404));

export default app;
export { CaseAgent } from "./CaseDO";
