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

export type TypesafeObservabilityLane = PaidSpendLane | "typesafe";

function typesafeApiKeyConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

/** Log-safe copy of judgment state: trim long strings, cap turn count. */
export function redactTypesafeState(state: EntryType): EntryType {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    if (typeof state === "string") {
      return state.length > 120 ? `${state.slice(0, 120)}…` : state;
    }
    return state;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "message" && typeof value === "string") {
      out[key] = value.length > 120 ? `${value.slice(0, 120)}…` : value;
      continue;
    }
    if (key === "recentTurns" && Array.isArray(value)) {
      out[key] = value.slice(0, 6).map((turn) => {
        if (!turn || typeof turn !== "object") return turn;
        const row = turn as Record<string, unknown>;
        const content =
          typeof row.content === "string" && row.content.length > 80
            ? `${row.content.slice(0, 80)}…`
            : row.content;
        return { ...row, content };
      });
      continue;
    }
    out[key] = value;
  }
  return out as EntryType;
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
      state: redactTypesafeState(state),
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
      state: redactTypesafeState(state),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
