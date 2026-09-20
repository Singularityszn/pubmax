// The ONE TypeSafe wrapper for System One judgments.
//
// App code imports `lib/ai/typesafe.server.ts` (server-only door). Plain-node
// CLIs import THIS module, the same split as `lib/contextDev.ts`.
//
// Without `TYPESAFE_API_KEY`, `systemOne` returns `null` so keyless dev and CI
// keep today's deterministic fallbacks.

import { TypeSafeClient, type Questions, type SystemOneResult } from "@typesafe-ai/sdk";

import { log } from "@/lib/log";

export { choice, noul, score, TypeSafeClient } from "@typesafe-ai/sdk";
export type { Questions, SystemOneResult };

export const TYPESAFE_DEFAULT_TIMEOUT_MS = 4_000;

export type SystemOneLane = string;

export type SystemOneOptions = {
  timeoutMs?: number;
  lane?: SystemOneLane;
};

function typesafeApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const key = env.TYPESAFE_API_KEY?.trim();
  return key || undefined;
}

/** Log context: question keys and distance only, never full venue payloads. */
function redactedStateForLog(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return { state: "[non-object]" };
  }
  const record = state as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof record.distanceMetres === "number") out.distanceMetres = record.distanceMetres;
  if ("a" in record) out.a = "[venue]";
  if ("b" in record) out.b = "[venue]";
  return out;
}

function recordTypesafeTiming(
  lane: SystemOneLane,
  durationMs: number,
  ok: boolean,
): void {
  log(ok ? "info" : "warn", "http.request", {
    route: `typesafe/${lane}`,
    method: "POST",
    status: ok ? 200 : 500,
    durationMs,
  });
}

/**
 * One batched System One call. Returns `null` when no API key is configured.
 */
export async function systemOne<Q extends Questions>(
  state: unknown,
  questions: Q,
  options: SystemOneOptions = {},
): Promise<SystemOneResult<Q> | null> {
  const apiKey = typesafeApiKey();
  if (!apiKey) return null;

  const lane = options.lane ?? "default";
  const timeoutMs = options.timeoutMs ?? TYPESAFE_DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  try {
    const client = new TypeSafeClient({ apiKey, logLevel: "off" });
    const result = await client.systemOne(
      { state: state as Parameters<TypeSafeClient["systemOne"]>[0]["state"], questions },
      { timeout: timeoutMs },
    );
    recordTypesafeTiming(lane, Date.now() - start, true);
    log("info", "typesafe.system_one", {
      lane,
      questionKeys: Object.keys(questions),
      ...redactedStateForLog(state),
    });
    return result;
  } catch (err) {
    recordTypesafeTiming(lane, Date.now() - start, false);
    log("warn", "typesafe.system_one_error", {
      lane,
      questionKeys: Object.keys(questions),
      ...redactedStateForLog(state),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/** Whether a judged TypeSafe pass can run in this environment. */
export function typesafeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return typesafeApiKey(env) != null;
}
