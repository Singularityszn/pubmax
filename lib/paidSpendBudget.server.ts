import "server-only";

import { publicApiError } from "@/lib/apiError";
import { log } from "@/lib/log";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { isLimited } from "@/lib/pintDrops";

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
  if (!spent) return null;
  // One structured line an operator can alert on. The lane and the ceiling are
  // the whole record: no address, no key, no caller.
  log("warn", "paid_spend.budget_spent", { lane, budget, windowMs: PAID_SPEND_BUDGET_WINDOW_MS });
  return publicApiError(PAID_SPEND_REFUSAL_LINE, PAID_SPEND_REFUSAL_CODE, 429, {
    retryable: true,
  });
}
