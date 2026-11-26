import "server-only";

import { randomUUID } from "node:crypto";
import { requireDynamicSupabaseAdmin } from "@/lib/supabase";

type Job = "step-out" | "cheap-pint";
export type NudgeCursor = {
  claim(job: Job, lease: string): Promise<{ cursor: string | null } | null>;
  advance(job: Job, lease: string, cursor: string | null, release: boolean): Promise<void>;
};

export const durableNudgeCursor: NudgeCursor = {
  async claim(job, lease) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("claim_nudge_job", { p_job: job, p_lease: lease } as never);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] as { cursor: string | null } | undefined : undefined;
    return row ?? null;
  },
  async advance(job, lease, cursor, release) {
    const { data, error } = await requireDynamicSupabaseAdmin().rpc("advance_nudge_job", { p_job: job, p_lease: lease, p_cursor: cursor, p_release: release } as never);
    if (error) throw error;
    if (data !== true) throw new Error("Nudge job lease lost");
  },
};

export async function walkNudgeJob<T extends { ownerActor: string }>(
  job: Job,
  list: (after: string | null, limit: number) => Promise<T[]>,
  visit: (row: T) => Promise<void>,
  checkpoint?: NudgeCursor,
): Promise<boolean> {
  const lease = randomUUID();
  const claimed = checkpoint ? await checkpoint.claim(job, lease) : { cursor: null };
  if (!claimed) return false;
  let cursor = claimed.cursor;
  const visited = new Set<string>();
  const deadline = Date.now() + 50_000;
  try {
    for (;;) {
      const page = await list(cursor, 25);
      if (page.length === 0) {
        await checkpoint?.advance(job, lease, null, true);
        return true;
      }
      for (const row of page) {
        if (row.ownerActor === cursor || visited.has(row.ownerActor)) throw new Error("Nudge cursor did not advance");
        if (Date.now() >= deadline) {
          await checkpoint?.advance(job, lease, cursor, true);
          return false;
        }
        await visit(row);
        visited.add(row.ownerActor);
        cursor = row.ownerActor;
        await checkpoint?.advance(job, lease, cursor, false);
      }
    }
  } catch (error) {
    await checkpoint?.advance(job, lease, cursor, true);
    throw error;
  }
}
