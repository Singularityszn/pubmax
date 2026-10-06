import "server-only";

import { getSupabaseAdmin, requiresSupabaseStore, type TypedSupabaseClient } from "@/lib/supabase";

/**
 * THE QUESTION AN UPTIME MONITOR ASKS: CAN THIS DEPLOYMENT REACH ITS DATABASE.
 *
 * `/api/version` answers from memory, so it stays green while Supabase is
 * paused, unreachable or out of quota. This probe reads one row of `rate_limits`
 * (the table every paid lane and every write already spends) through the same
 * admin client every store uses, so a healthy answer means the whole durable
 * path works.
 *
 * Three outcomes, and a keyless process is not a failure:
 *   - `ok`             the query answered.
 *   - `not_configured` no Supabase here (dev, e2e). Healthy, and says so.
 *   - `down`           configured and the query failed or timed out. Also the
 *                      answer for a deployed production process with no client,
 *                      because `requiresSupabaseStore` refuses the in-memory
 *                      fallback there.
 *
 * The answer is held for `HEALTH_CACHE_MS` per instance, so a monitor on a
 * one-minute cadence, or a script on a loop, costs the database one read per
 * instance per window instead of one per request.
 */
export type DatabaseHealth = "ok" | "not_configured" | "down";

export const HEALTH_CACHE_MS = 15_000;
export const HEALTH_TIMEOUT_MS = 4_000;

type Cached = { at: number; value: DatabaseHealth };
let cached: Cached | null = null;

/** Test seam: forget the held answer. */
export function resetDatabaseHealthCache(): void {
  cached = null;
}

async function probe(client: TypedSupabaseClient, timeoutMs: number): Promise<DatabaseHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { error } = await client
      .from("rate_limits")
      .select("key", { head: true })
      .limit(1)
      .abortSignal(controller.signal);
    return error ? "down" : "ok";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDatabaseHealth(
  options: { now?: () => number; timeoutMs?: number } = {},
): Promise<DatabaseHealth> {
  const now = options.now ?? Date.now;
  if (cached && now() - cached.at < HEALTH_CACHE_MS) return cached.value;

  const client = getSupabaseAdmin();
  let value: DatabaseHealth;
  if (!client) value = requiresSupabaseStore() ? "down" : "not_configured";
  else value = await probe(client, options.timeoutMs ?? HEALTH_TIMEOUT_MS);

  cached = { at: now(), value };
  return value;
}
