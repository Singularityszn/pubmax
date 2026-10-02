// The plain-node half of the TypeSafe lane.
//
// `lib/ai/typesafe.server.ts` is the APP door: `server-only`, the `typesafe`
// paid-spend lane and route observability. `server-only` makes it unimportable
// from a plain Node CLI, so the offline judged passes import THIS module.
//
// What it must NOT become is a second policy. The retry rule, the wall-clock
// deadline and the base URL below are the server door's, written out again
// because the two cannot share a constant without dragging `server-only` into
// a CLI. Both copies are fenced: `__tests__/legalPages.test.ts` sweeps every
// absolute host under `lib/ai/` and fails on one `/privacy` does not disclose.
//
// Without `TYPESAFE_API_KEY`, `systemOne` returns `null`, so keyless dev, CI
// and the default `npm run canonicalize:venues` keep today's rules.

import {
  TypeSafeClient,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

import { log } from "@/lib/log";

export type { EntryType, Questions, SystemOneResult };

/** The one host this module talks to; disclosed on `/privacy`. */
const TYPESAFE_API_BASE_URL = "https://api.typesafe.ai";

const TYPESAFE_DEFAULT_TIMEOUT_MS = 4_000;

export type SystemOneOptions = {
  timeoutMs?: number;
  /** Which caller spent the call, for the log line. */
  lane?: string;
};

function typesafeApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.TYPESAFE_API_KEY?.trim() || undefined;
}

/** Whether a judged TypeSafe pass can run in this environment. */
export function typesafeConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return typesafeApiKey(env) != null;
}

/**
 * One System One call. Returns `null` when there is no key AND when the call
 * fails, the same contract as the server door, so a caller has one branch to
 * write: no judgment, keep the deterministic rule.
 *
 * THE RETRY POLICY IS OURS, as it is for the server door and for context.dev:
 * the SDK would otherwise retry twice and honour a `Retry-After` of up to a
 * minute, billing three calls for one. `signal` is a wall-clock deadline, so
 * `timeoutMs` is the whole cost of the call and not the cost of one attempt.
 */
export async function systemOne<Q extends Questions>(
  state: EntryType,
  questions: Q,
  options: SystemOneOptions = {},
): Promise<SystemOneResult<Q> | null> {
  const apiKey = typesafeApiKey();
  if (!apiKey) return null;

  const lane = options.lane ?? "default";
  const timeoutMs = options.timeoutMs ?? TYPESAFE_DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  const client = new TypeSafeClient({
    apiKey,
    logLevel: "off",
    baseURL: process.env.TYPESAFE_BASE_URL?.trim() || TYPESAFE_API_BASE_URL,
    retry: { maxRetries: 0 },
  });

  try {
    const result = await client.systemOne(
      { state, questions },
      { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
    );
    // The line names the lane and what the call cost. The state never reaches
    // a log: it carries venue rows, and the server door is equally explicit
    // that prose does not.
    log("info", "typesafe.system_one", {
      lane,
      durationMs: Date.now() - start,
      questionCount: Object.keys(questions).length,
      model: result.model,
    });
    return result;
  } catch (err) {
    log("warn", "typesafe.system_one_failed", {
      lane,
      durationMs: Date.now() - start,
      questionCount: Object.keys(questions).length,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
