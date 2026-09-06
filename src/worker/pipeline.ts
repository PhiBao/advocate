// Case pipeline (D2): extraction -> deterministic rules -> findings.
// Runs in `ctx.waitUntil` after upload so the 201 responds immediately and
// the case page flips from "reading" to findings via polling.
// Every outcome — success, scanned PDF, model failure — lands as an explicit
// timeline event. A case never silently sits in "reading".

import { addTimelineEvent, ensureQuestions, listDocuments, saveExtraction, saveFindings, setCaseStatus } from "./db";
import { extractDocument, ScannedPdfError, type CaseExtraction } from "./extract";
import { generateQuestions } from "./intake";
import { clientFromEnv, LlmError } from "./llm";
import { detectRedFlags, mismatchRule, type Finding } from "./rules";
import type { Env } from "./types";

function summarize(ext: CaseExtraction): string {
  const bits: string[] = [];
  bits.push(ext.documentKind === "unknown" ? "a document" : `your ${ext.documentKind.toUpperCase()}`);
  if (ext.providerName) bits.push(`from ${ext.providerName}`);
  bits.push(`with ${ext.lineItems.length} charge line${ext.lineItems.length === 1 ? "" : "s"}`);
  if (ext.patientResponsibilityCents !== null) {
    const d = (ext.patientResponsibilityCents / 100).toFixed(2);
    bits.push(`and $${d} listed as your responsibility`);
  }
  return `Read ${bits.join(" ")}.`;
}

export async function processCase(env: Env, caseId: string): Promise<void> {
  const docs = await listDocuments(env, caseId);
  if (docs.length === 0) return;

  const client = clientFromEnv(env);
  const extractions: Array<{ documentId: string; ext: CaseExtraction }> = [];
  const failures: string[] = [];

  for (const doc of docs) {
    const obj = await env.DOCS.get(doc.object_key);
    if (!obj) {
      failures.push("A file went missing in storage — please re-upload it.");
      continue;
    }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    try {
      const ext = await extractDocument(client, bytes, doc.content_type);
      extractions.push({ documentId: doc.id, ext });
      await saveExtraction(env, { caseId, documentId: doc.id, json: JSON.stringify(ext) });
      await addTimelineEvent(env, {
        caseId,
        kind: "reading_started",
        title: "Reading finished for one document",
        body: summarize(ext),
      });
      if (ext.payerName) {
        // Best-effort payer capture; failures must not break the pipeline.
        try {
          await env.DB.prepare("UPDATE cases SET payer_name = ?1, updated_at = ?2 WHERE id = ?3")
            .bind(ext.payerName, Date.now(), caseId)
            .run();
        } catch {
          // ignore
        }
      }
    } catch (err) {
      if (err instanceof ScannedPdfError) {
        failures.push(
          "One file looks like a scanned PDF with no readable text. Clear photos of each page work much better — tap below to start over with photos.",
        );
      } else if (err instanceof LlmError) {
        failures.push("Our reader hiccuped on one file. It usually works on retry.");
      } else {
        failures.push("One file couldn't be read. Photos of each page work best.");
      }
    }
  }

  const findings: Finding[] = [];
  for (const { ext } of extractions) findings.push(...detectRedFlags(ext));
  findings.push(
    ...mismatchRule(
      extractions.map((e) => e.ext).filter((e) => e.documentKind === "bill"),
      extractions.map((e) => e.ext).filter((e) => e.documentKind === "eob"),
    ),
  );
  await saveFindings(env, caseId, findings);

  // Pre-generate intake questions so they're waiting when the user arrives.
  // Best-effort: the frontend retries via POST …/questions on failure.
  if (extractions.length > 0) {
    try {
      const qs = await generateQuestions(client, {
        extractions: extractions.map((e) => e.ext),
        findings,
      });
      await ensureQuestions(env, caseId, qs);
    } catch {
      await addTimelineEvent(env, {
        caseId,
        kind: "note",
        title: "Questions are on their way",
        body: "Your follow-up questions will appear here in a moment.",
      });
    }
  }

  if (findings.length > 0) {
    await addTimelineEvent(env, {
      caseId,
      kind: "findings_ready",
      title: `Found ${findings.length} thing${findings.length === 1 ? "" : "s"} worth a look`,
      body: "Review them below. Next, a few quick questions so we can build your appeal.",
    });
  } else if (extractions.length > 0) {
    await addTimelineEvent(env, {
      caseId,
      kind: "findings_ready",
      title: "Nothing alarming found",
      body: "The charges look consistent. We'll still walk you through what each part means before you pay.",
    });
  }
  for (const f of failures) {
    await addTimelineEvent(env, { caseId, kind: "note", title: "A file needs attention", body: f });
  }

  // Always leave "reading": findings (or an honest failure note) are now shown.
  await setCaseStatus(env, caseId, "needs_info");
}
