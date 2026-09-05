// One durable agent per case. Owns reminders, deadline alarms, and the
// follow-up schedule — the "agent works while you're away" layer.
// State transitions themselves live in D1; the DO is the clock + scheduler.

import { DurableObject } from "cloudflare:workers";
import { addTimelineEvent } from "./db";
import type { Env, TimelineKind } from "./types";

interface Reminder {
  id: string;
  caseId: string;
  kind: TimelineKind;
  title: string;
  body: string;
  fireAt: number;
}

export class CaseAgent extends DurableObject<Env> {
  /** Schedule a reminder. Replaces any pending reminder with the same id. */
  async scheduleReminder(r: Reminder): Promise<{ ok: true }> {
    const existing = (await this.ctx.storage.get<Reminder[]>("reminders")) ?? [];
    const next = [...existing.filter((x) => x.id !== r.id), r].sort((a, b) => a.fireAt - b.fireAt);
    await this.ctx.storage.put("reminders", next);
    await this.setAlarmForNext();
    return { ok: true };
  }

  async cancelReminder(id: string): Promise<{ ok: true }> {
    const existing = (await this.ctx.storage.get<Reminder[]>("reminders")) ?? [];
    await this.ctx.storage.put(
      "reminders",
      existing.filter((x) => x.id !== id),
    );
    await this.setAlarmForNext();
    return { ok: true };
  }

  private async setAlarmForNext(): Promise<void> {
    const pending = (await this.ctx.storage.get<Reminder[]>("reminders")) ?? [];
    const upcoming = pending.filter((r) => r.fireAt > Date.now());
    // Drop anything already past-due without firing (stale schedules).
    await this.ctx.storage.put("reminders", upcoming);
    if (upcoming.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const first = upcoming[0];
    if (first) await this.ctx.storage.setAlarm(first.fireAt);
  }

  override async alarm(): Promise<void> {
    const pending = (await this.ctx.storage.get<Reminder[]>("reminders")) ?? [];
    const due = pending.filter((r) => r.fireAt <= Date.now());
    const rest = pending.filter((r) => r.fireAt > Date.now());
    await this.ctx.storage.put("reminders", rest);
    for (const r of due) {
      await addTimelineEvent(this.env, {
        caseId: r.caseId,
        kind: r.kind,
        title: r.title,
        body: r.body,
      });
    }
    await this.setAlarmForNext();
  }

  /** Internal RPC surface used by the Worker (never exposed to browsers). */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/reminders" && request.method === "GET") {
      const pending = (await this.ctx.storage.get<Reminder[]>("reminders")) ?? [];
      return Response.json({ reminders: pending });
    }
    return new Response("Not found", { status: 404 });
  }
}
