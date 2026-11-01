import "server-only";

import { after } from "next/server";

import { ALERT_COOLDOWN_MS, alertWebhookUrl, sendAlert } from "@/lib/alertSink";
import { publicApiError } from "@/lib/apiError";
import { log } from "@/lib/log";
import {
  PAID_SPEND_BUDGET_WINDOW_MS,
  PAID_SPEND_REFUSAL_CODE,
  PAID_SPEND_REFUSAL_LINE,
  paidSpendAddressKey,
  paidSpendAddressShare,
  paidSpendBudgetKey,
  paidSpendDailyBudget,
  paidSpendWarningThreshold,
  type PaidSpendLane,
} from "@/lib/paidSpendBudget";
import { isLimited, RATE_LIMIT_RPC_TIMEOUT_MS } from "@/lib/pintDrops";
import {
  checkRateLimitDurableDetailed,
  clientIp,
  hashIp,
  readRateLimitDurableUsage,
} from "@/lib/supabase";

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
 * Returns true when the paid call is admitted. A spent address share, spent
 * lane, or unavailable configured limiter returns false. The lane key names
 * only the lane (`lib/paidSpendBudget.ts` owns why). Every caller shares one
 * budget, which no header can widen. If the configured Supabase limiter cannot
 * answer, admission fails closed. It never uses a process-local fallback that
 * resets on a cold start.
 *
 * Pass the `request` on a lane any anonymous caller can reach. The caller
 * address's share (`paidSpendAddressShare`) is then spent FIRST, so one address
 * cannot spend the whole lane and switch it off for everybody else, and an
 * address over its share never touches the lane.
 *
 * Called AFTER the per-address limiter, so an ordinary flood is turned away by
 * its own budget before it can eat the shared one, and after any gate that
 * refuses a caller outright, so a rejected caller spends nothing.
 */
export async function admitPaidSpend(lane: PaidSpendLane, request?: Request): Promise<boolean> {
  const budget = paidSpendDailyBudget(lane);
  // A closed lane refuses below with its own log line, so it takes no share.
  if (request && budget > 0) {
    const share = paidSpendAddressShare(budget);
    const addressKey = paidSpendAddressKey(lane, hashIp(clientIp(request)));
    const shareSpent = await isLimited(addressKey, addressKey, share, PAID_SPEND_BUDGET_WINDOW_MS, {
      failClosed: true,
    });
    if (shareSpent) {
      // The lane and the share are the whole record: no address, no key.
      log("warn", "paid_spend.address_share_spent", {
        lane, share, windowMs: PAID_SPEND_BUDGET_WINDOW_MS,
      });
      return false;
    }
  }
  const key = paidSpendBudgetKey(lane);
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
    return true;
  }
  // One structured line an operator can alert on. The lane and the ceiling are
  // the whole record: no address, no key, no caller.
  log("warn", "paid_spend.budget_spent", { lane, budget, windowMs: PAID_SPEND_BUDGET_WINDOW_MS });
  return false;
}

/**
 * Spend one call from a paid lane, as a ready 429 when the caller's share or
 * the lane is spent and `null` when the caller may proceed. A route with a
 * deterministic or grounded answer asks `admitPaidSpend` instead and withholds
 * only the model.
 */
export async function paidSpendBudgetRefusal(
  lane: PaidSpendLane,
  request?: Request,
): Promise<Response | null> {
  if (await admitPaidSpend(lane, request)) return null;
  return publicApiError(PAID_SPEND_REFUSAL_LINE, PAID_SPEND_REFUSAL_CODE, 429, {
    retryable: true,
  });
}
