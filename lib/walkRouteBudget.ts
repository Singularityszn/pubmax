// SERVER-ONLY. Global DAILY budget for OUTBOUND OpenRouteService calls.
//
// /api/walk-route already carries a per-CLIENT limiter (20/min, keyed on the
// hashed IP — lib/pintDrops isLimited, same seam as every write route). That
// caps one client, but nothing caps the GLOBAL daily ORS spend. The free ORS
// tier is ~2500 calls/day, and the durable limiter's documented fail-open path
// makes the per-client cap leaky exactly when it matters: when Supabase can't
// answer, isLimited degrades to a per-INSTANCE in-memory budget, so under
// Friday-night load each cold-start instance grants its own 20/min. Multiplied
// across instances the aggregate can silently drain the daily ORS quota, after
// which ORS 403s and EVERY route degrades to straight lines for everyone.
//
// This module adds a DURABLE global daily counter for the ACTUAL provider calls,
// reusing check_rate_limit through lib/pintDrops reserveRateLimit
// with a single global bucket keyed `ors-global:<UTC-date>` and a 24h window.
// Each real provider call consumes one unit; cache hits and the keyless path
// never call in here, so they never consume budget. Over budget -> the caller
// skips the provider and serves the straight leg (the existing fail-soft path).
//
// COST: admission takes at most one durable round-trip per provider call, and an
// in-process short-circuit once the day is exhausted (the exhausted verdict is
// cached for a few minutes), so an exhausted Friday night costs ZERO durable
// reads per request. The dominant debounced map-redraw sends one request with
// at most one uncached leg, i.e. one durable read; a cold full route does one
// per uncached leg (bounded by WALK_ROUTE_MAX_STOPS - 1). Releasing an unused
// durable reservation separately reads the bucket and attempts an atomic refund.
//
// DEGRADED MODE (documented, inherited from isLimited):
//   • Supabase configured + durable RPC answers -> the true GLOBAL cap holds.
//   • Supabase not configured (local/dev/CI)     -> per-instance in-memory cap.
//   • Durable RPC missing / transient outage      -> isLimited fails open to the
//     per-instance in-memory budget (rate_limit.fail_open warn). On Vercel each
//     instance then keeps its own daily counter, so the effective global cap is
//     looser than ORS_DAILY_BUDGET by roughly the live instance count. That is
//     the SAME accepted trade the write-path limiter makes: durable is the
//     design target, the in-memory budget is the fail-soft floor — never a hard
//     stop on routing, which stays fail-soft to straight lines throughout.

import { reserveRateLimit, type RateLimitReservation } from "@/lib/pintDrops";
import { log } from "@/lib/log";
import { DAY_MS } from "@/lib/dayMs";

/** Default daily cap on outbound ORS calls. 2000 leaves ~500 headroom under the
 *  ~2500/day free tier so a burst that trips the soft cap still can't 403 ORS. */
export const ORS_DAILY_BUDGET_DEFAULT = 2000;

/** One UTC day. The bucket key already rolls per calendar day; the matching
 *  window makes the durable counter prune anything older than a day too. */
export const ORS_BUDGET_WINDOW_MS = DAY_MS;

/** Cache exhaustion for this long unless a successful same-day refund clears it.
 *  A new UTC day rechecks immediately. A raised cap takes effect after expiry. */
const ORS_BUDGET_EXHAUSTED_TTL_MS = 5 * 60 * 1000;

/**
 * Configured daily budget. `ORS_DAILY_BUDGET` overrides the default; a missing,
 * non-numeric, or non-positive value falls back to ORS_DAILY_BUDGET_DEFAULT.
 * Read per call so an env change (or a test stub) takes effect without a reload.
 */
export function orsDailyBudget(): number {
  const raw = Number(process.env.ORS_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : ORS_DAILY_BUDGET_DEFAULT;
}

/** The global bucket key for a given instant: `ors-global:<UTC-date>`. Rolls at
 *  UTC midnight so each calendar day gets a fresh budget. */
export function orsBudgetKey(now: number = Date.now()): string {
  return `ors-global:${new Date(now).toISOString().slice(0, 10)}`;
}

// In-process short-circuit: once the durable check reports the day is spent, we
// remember that (scoped to the UTC date so a rolled day is never held down by a
// stale flag) and skip the durable round-trip until expiry or a same-day refund.
let exhausted: { date: string; until: number } = { date: "", until: 0 };
// A refusal that started before a same-day refund must not restore exhaustion.
const refundGenerations = new Map<string, number>();

/**
 * Emit ONE structured WARN when the global daily ORS budget is first observed
 * exhausted in a window. Mirrors the rate_limit.fail_open idiom (lib/pintDrops):
 * a single grep-able line an operator can alert on. `date` (not `key`) carries
 * the bucket day — the logger redacts any field literally named `key`, and the
 * date is not sensitive anyway. No IP, key material, or PII reaches the log.
 */
function warnOrsBudgetExhausted(date: string, budget: number): void {
  log("warn", "ors_budget.exhausted", { date, budget, windowMs: ORS_BUDGET_WINDOW_MS });
}

/**
 * Reserve one unit for an outbound call, or return null when none is available.
 * Commit immediately before dispatch. Release in finally to attempt a refund
 * to the original backend if cancellation prevented dispatch.
 *
 * Call this ONLY immediately before a real ORS fetch — never for a cache hit or
 * the keyless path — so budget is consumed per PROVIDER CALL, not per request.
 * Uses the same check_rate_limit seam as isLimited, inheriting its documented
 * durable/degraded behaviour verbatim (see the module header).
 */
export async function reserveOrsBudget(now: number = Date.now(), signal?: AbortSignal): Promise<RateLimitReservation | null> {
  if (signal?.aborted) return null;
  const date = new Date(now).toISOString().slice(0, 10);

  // Short-circuit: the day is already known-exhausted and the TTL hasn't lapsed.
  // Costs nothing — no durable round-trip, no provider call.
  if (exhausted.date === date && now < exhausted.until) return null;

  const key = orsBudgetKey(now);
  const refundGeneration = refundGenerations.get(date) ?? 0;
  const reservation = await reserveRateLimit(key, orsDailyBudget(), ORS_BUDGET_WINDOW_MS, signal);
  if (!reservation && !signal?.aborted && refundGeneration === (refundGenerations.get(date) ?? 0)) {
    exhausted = { date, until: now + ORS_BUDGET_EXHAUSTED_TTL_MS };
    warnOrsBudgetExhausted(date, orsDailyBudget());
    return null;
  }
  return reservation && {
    commit: reservation.commit,
    release: async () => {
      const returned = await reservation.release();
      if (returned) {
        refundGenerations.set(date, (refundGenerations.get(date) ?? 0) + 1);
        if (exhausted.date === date) exhausted = { date: "", until: 0 };
      }
      return returned;
    },
  };
}

/** Non-cancellable callers spend their admitted reservation immediately. */
export async function consumeOrsBudget(now: number = Date.now()): Promise<boolean> {
  const reservation = await reserveOrsBudget(now);
  return reservation?.commit() ?? false;
}

/** Test-only: clear the in-process exhausted flag between cases. The durable
 *  counter itself resets via the supabase/in-memory limiter reset. */
export function __resetOrsBudget(): void {
  exhausted = { date: "", until: 0 };
  refundGenerations.clear();
}
