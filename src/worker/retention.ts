// Retention sweep: enforce the 90-day auto-delete we promise in the privacy
// note. Runs daily via cron; also safe to call manually. Bounded per run so a
// backlog can't blow past subrequest limits.

import type { Env } from "./types";

const BATCH_LIMIT = 25;

export async function retentionSweep(env: Env, now = Date.now()): Promise<{ deleted: number }> {
  const expired = await env.DB.prepare(
    `SELECT id FROM cases WHERE delete_after < ?1 LIMIT ?2`,
  )
    .bind(now, BATCH_LIMIT)
    .all<{ id: string }>();
  const caseIds = (expired.results ?? []).map((r) => r.id);
  let deleted = 0;

  for (const caseId of caseIds) {
    try {
      const keys = await env.DB.prepare(`SELECT object_key FROM documents WHERE case_id = ?1`)
        .bind(caseId)
        .all<{ object_key: string }>();
      const objectKeys = (keys.results ?? []).map((r) => r.object_key);
      if (objectKeys.length > 0) {
        await env.DOCS.delete(objectKeys);
      }
      // Children first (explicit), then the case row. DO storage purges last.
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM documents WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM timeline_events WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM findings WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM extractions WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM intake_questions WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM case_summaries WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM letters WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM deliveries WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM outcomes WHERE case_id = ?1`).bind(caseId),
        env.DB.prepare(`DELETE FROM cases WHERE id = ?1`).bind(caseId),
      ]);
      const stub = env.CASE_DO.get(env.CASE_DO.idFromName(caseId));
      await stub.fetch("https://do/purge", { method: "POST" });
      deleted += 1;
    } catch (err) {
      console.error("retention sweep failed for case", caseId, err instanceof Error ? err.message : "unknown");
    }
  }
  return { deleted };
}
