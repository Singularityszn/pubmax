import "server-only";

import {
  type Questions,
  type SystemOneResult,
  TypeSafeClient,
  type EntryType,
} from "@typesafe-ai/sdk";

import { log } from "@/lib/log";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import { recordTypesafeTiming } from "@/lib/routeObservability";
import type { PaidSpendLane } from "@/lib/paidSpendBudget";

const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * The one host this module talks to, named here so `/privacy` can be held to it
 * (`__tests__/legalPages.test.ts` reads the prompt-text recipient table out of
 * the source that contacts each host). `TYPESAFE_BASE_URL` still overrides it
 * for a staging endpoint; the SDK would otherwise pick this same default up
 * silently and no fence would see the egress.
 */
export const TYPESAFE_API_BASE_URL = "https://api.typesafe.ai";

/**
 * Which caller a timing line is attributed to. `typesafe` is the SPEND lane and
 * one budget covers every caller; this names the feature that spent it.
 */
export type TypesafeObservabilityLane = PaidSpendLane;

/**
 * What a log line may say about the judgment state: its SIZE and nothing else.
 * The state carries a drinker's typed message and their recent turns, and
 * `lib/log.ts` is explicit that a caller hands it already-safe fields. Truncated
 * prose is still prose, so none of it reaches a log; the counts are what an
 * operator actually reads when a call is slow or refused.
 */
function stateSize(state: EntryType): { messageChars: number; turnCount: number } {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return { messageChars: typeof state === "string" ? state.length : 0, turnCount: 0 };
  }
  const message = (state as Record<string, unknown>).message;
  const turns = (state as Record<string, unknown>).recentTurns;
  return {
    messageChars: typeof message === "string" ? message.length : 0,
    turnCount: Array.isArray(turns) ? turns.length : 0,
  };
}

function typesafeApiKeyConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

/**
 * TypeSafe System One with deployment budget, timeout and observability.
 * Returns `null` when the API key is unset, the lane budget is spent, or the
 * call fails, so callers keep their deterministic fallback.
 */
export async function systemOne<Q extends Questions>(
  state: EntryType,
  questions: Q,
  options: { timeoutMs?: number; lane: TypesafeObservabilityLane },
): Promise<SystemOneResult<Q> | null> {
  if (!typesafeApiKeyConfigured()) {
    recordTypesafeTiming(options.lane, 0, "skipped");
    return null;
  }

  // The lane is spelled out here on purpose: `__tests__/paidSpendBudget.test.ts`
  // greps each lane's owning file for this exact call, so a lane cannot be
  // declared and then quietly never spent.
  const budgetRefusal = await paidSpendBudgetRefusal("typesafe");
  if (budgetRefusal) {
    log("warn", "typesafe.budget_spent", { lane: options.lane });
    recordTypesafeTiming(options.lane, 0, "skipped");
    return null;
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();
  // THE RETRY POLICY IS OURS, as it is for context.dev (`lib/AGENTS.md`). The
  // SDK defaults to two retries with no total budget and honours a `Retry-After`
  // up to sixty seconds, so a 429 or a hung endpoint would hold a Pub Pal reply
  // for minutes on the request path and bill three calls against one counted
  // budget decrement. Retries off, and `signal` is a WALL-CLOCK deadline the SDK
  // applies to the request and to any pending wait, so `timeoutMs` is the whole
  // cost of this call and not the cost of one attempt.
  const client = new TypeSafeClient({
    logLevel: "off",
    baseURL: process.env.TYPESAFE_BASE_URL?.trim() || TYPESAFE_API_BASE_URL,
    retry: { maxRetries: 0 },
  });

  try {
    const result = await client.systemOne(
      { state, questions },
      { timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs) },
    );
    const durationMs = Date.now() - start;
    recordTypesafeTiming(options.lane, durationMs, "ok");
    log("info", "typesafe.system_one", {
      lane: options.lane,
      durationMs,
      questionCount: Object.keys(questions).length,
      ...stateSize(state),
      model: result.model,
    });
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    recordTypesafeTiming(options.lane, durationMs, "error");
    log("warn", "typesafe.system_one_failed", {
      lane: options.lane,
      durationMs,
      questionCount: Object.keys(questions).length,
      ...stateSize(state),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
