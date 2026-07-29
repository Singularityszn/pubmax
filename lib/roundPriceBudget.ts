// The device budget a Round's drink lines pay before they may enter the
// community price store (app/api/rounds/[code]).
//
// A Round with drink lines IS a price submission, so it uses the same
// cross-venue key namespace and hourly cap as /api/price-submit. The Round
// route's actor remains device-derived, while direct price submissions use an
// authenticated profile actor. It charges ONE UNIT PER LINE, because a turn
// carrying ten observations costs the map ten times what a single tap does.
//
// Per-line charging is why the durable limiter's own fallback is wrong here: it
// tightens to a handful of calls, which one honest itemised round would exhaust
// on its fourth drink, turning a limiter outage into "you cannot log a round".
// So when the durable check cannot answer, this does not fail open or closed —
// it charges a per-instance allowance sized at exactly one genuine round
// (ROUND_SPEND_PRICE_LINE_MAX lines per actor per window): one full turn lands,
// a device cannot spray, and the degraded decision is logged once per turn on
// the same `rate_limit.fail_open` event an operator already alerts on.

import { log } from "@/lib/log";
import { isRateLimited } from "@/lib/pintDrops";
import { ROUND_SPEND_PRICE_LINE_MAX } from "@/lib/rounds";
import { checkRateLimitDurableDetailed, isSupabaseConfigured } from "@/lib/supabase";

/** Same cap and window /api/price-submit applies to its account actor key. */
export const ROUND_PRICE_ACTOR_LIMIT = 30;
export const ROUND_PRICE_WINDOW_MS = 3_600_000;

/**
 * How long to tell a caller to wait when the degraded allowance is spent. The
 * house retry hint for a temporarily unavailable dependency (see
 * lib/planSigningHttp.server): short, because what the caller is waiting on is
 * the durable limiter coming back, not the hour-long budget window.
 */
export const ROUND_PRICE_DEGRADED_RETRY_SECONDS = 60;

/**
 * How the verdict was reached. "durable" is the Round hourly cap answering,
 * "memory" the keyless local budget, and "degraded" the bounded one-round
 * allowance that stands in while the durable limiter is unreachable — a
 * refusal there is our outage, not the drinker's doing, so the caller says so.
 */
export type RoundPriceBudgetMode = "durable" | "degraded" | "memory";

export type RoundPriceBudget = {
  allowed: boolean;
  mode: RoundPriceBudgetMode;
};

export function roundPriceActorKey(actor: string | undefined): string {
  return `price-submit-actor:${actor ?? "anon"}`;
}

function chargeInMemory(key: string, lines: number, limit: number): boolean {
  const now = Date.now();
  let allowed = true;
  for (let charged = 0; charged < lines; charged += 1) {
    if (isRateLimited(key, now, limit, ROUND_PRICE_WINDOW_MS)) allowed = false;
  }
  return allowed;
}

function degradedAllowance(
  key: string,
  lines: number,
  reason: string,
): RoundPriceBudget {
  const strict = process.env.RATE_LIMIT_STRICT === "1";
  const allowed = strict
    ? false
    : chargeInMemory(`${key}:degraded`, lines, ROUND_SPEND_PRICE_LINE_MAX);
  log("warn", "rate_limit.fail_open", {
    reason,
    mode: "degraded",
    surface: "round.price_lines",
    effectiveLimit: strict ? 0 : ROUND_SPEND_PRICE_LINE_MAX,
    windowMs: ROUND_PRICE_WINDOW_MS,
    lines,
    allowed,
  });
  return { allowed, mode: "degraded" };
}

/**
 * Charge one unit per drink line this turn will submit. Total, never throws:
 * the caller gets a verdict and the mode that produced it.
 */
export async function chargeRoundPriceLines(
  actor: string | undefined,
  lines: number,
): Promise<RoundPriceBudget> {
  const key = roundPriceActorKey(actor);
  if (lines <= 0) return { allowed: true, mode: "durable" };

  if (!isSupabaseConfigured()) {
    return {
      allowed: chargeInMemory(key, lines, ROUND_PRICE_ACTOR_LIMIT),
      mode: "memory",
    };
  }

  for (let charged = 0; charged < lines; charged += 1) {
    const { verdict, reason } = await checkRateLimitDurableDetailed(
      key,
      ROUND_PRICE_ACTOR_LIMIT,
      ROUND_PRICE_WINDOW_MS,
    );
    if (verdict === true) return { allowed: false, mode: "durable" };
    if (verdict === false) continue;
    return degradedAllowance(key, lines, reason ?? "unknown");
  }
  return { allowed: true, mode: "durable" };
}
