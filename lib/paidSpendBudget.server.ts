import "server-only";

import { after } from "next/server";

import { ALERT_COOLDOWN_MS, alertWebhookUrl, sendAlert } from "@/lib/alertSink";
import { publicApiError } from "@/lib/apiError";
import { log } from "@/lib/log";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
  paidSpendWarningThreshold,
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { isLimited, RATE_LIMIT_RPC_TIMEOUT_MS } from "@/lib/pintDrops";
import { checkRateLimitDurableDetailed, readRateLimitDurableUsage } from "@/lib/supabase";

/** A durable claim prevents concurrent instances from sending the same warning. */
async function warnBeforeRequestCap(lane: PaidSpendLane, budget: number): Promise<void> {
  try {
    if (!alertWebhookUrl() || budget <= 0) return;
    const used = await readRateLimitDurableUsage(
      paidSpendBudgetKey(lane),
      PAID_SPEND_BUDGET_WINDOW_MS,
      AbortSignal.timeout(RATE_LIMIT_RPC_TIMEOUT_MS),
    );
    if (used === null) return;
    const threshold = paidSpendWarningThreshold(used, budget);
    if (threshold === null) return;
    const source = `paid_spend.near_cap.${lane}.${threshold}`;
    const { verdict } = await checkRateLimitDurableDetailed(
      source, 1, ALERT_COOLDOWN_MS, AbortSignal.timeout(RATE_LIMIT_RPC_TIMEOUT_MS),
    );
    // Unknown admission must never fall back to an instance-local warning claim.
    if (verdict !== false) return;
    const remaining = budget - used;
    await sendAlert({
      source,
      text: `${lane}: ${used}/${budget} requests in the rolling 24-hour window (${threshold}% warning, ${remaining} request${remaining === 1 ? "" : "s"} remaining)`,
    });
  } catch {
    // Monitoring cannot change the paid request's admission verdict.
  }
}

/**
 * Spend one call from a paid lane's deployment-wide daily ceiling.
 *
 * Returns a ready 429 when the ceiling is spent and `null` when the caller may
 * proceed. The key names the lane alone (`lib/paidSpendBudget.ts` owns why), so
 * every caller of a lane shares one budget and no header can widen it. Fail
 * closed on purpose: a configured Supabase whose durable limiter cannot answer
 * refuses rather than dropping to a per-instance budget a cold start resets.
 *
 * Called AFTER the per-address limiter, so an ordinary flood is turned away by
 * its own budget before it can eat the shared one, and after any gate that
 * refuses a caller outright, so a rejected caller spends nothing.
 */
export async function paidSpendBudgetRefusal(lane: PaidSpendLane): Promise<Response | null> {
  const key = paidSpendBudgetKey(lane);
  const budget = paidSpendDailyBudget(lane);
  const spent = await isLimited(key, key, budget, PAID_SPEND_BUDGET_WINDOW_MS, {
    failClosed: true,
  });
  if (!spent) {
    const warning = warnBeforeRequestCap(lane, budget);
    try {
      after(warning);
    } catch {
      // Outside a request scope, the bounded monitoring promise still runs.
    }
    return null;
  }
  // One structured line an operator can alert on. The lane and the ceiling are
  // the whole record: no address, no key, no caller.
  log("warn", "paid_spend.budget_spent", { lane, budget, windowMs: PAID_SPEND_BUDGET_WINDOW_MS });
  return publicApiError(PAID_SPEND_REFUSAL_LINE, PAID_SPEND_REFUSAL_CODE, 429, {
    retryable: true,
  });
}
