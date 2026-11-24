// GET /api/cron/reconcile-price-trust - retry derived trust events and credits.
//
// Community-price persistence remains authoritative when this derived write is
// unavailable. The durable queue keeps the pair until one bounded run records
// its event and account credits, then acknowledges the exact queue revision.
// AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { scanListedPriceAlerts } from "@/lib/priceAlertListingsScan.server";
import { drainPendingPriceTrustReconciliations } from "@/lib/priceTrustImpact.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RECONCILIATION_BATCH_SIZE = 20;

export async function GET(request: Request): Promise<Response> {
  const requestStartedAt = Date.now();
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await drainPendingPriceTrustReconciliations(
      RECONCILIATION_BATCH_SIZE,
    );
    const alerts = await scanListedPriceAlerts(requestStartedAt);
    if (result.degraded || result.pending > 0 || alerts.incomplete || alerts.retryable > 0 || alerts.uncertain > 0) {
      return publicApiError(
        "Price reconciliation or alert delivery is still pending.",
        "UNAVAILABLE",
        503,
        {
          retryable: result.degraded || result.pending > 0 || alerts.incomplete || alerts.retryable > 0,
          compatibilityFields: { ok: false, ...result, alerts },
        },
      );
    }
    return jsonNoStore({ ok: true, ...result, alerts });
  } catch (error) {
    console.error("[cron:reconcile-price-trust] job failed:", error);
    return publicApiError(
      "Price trust reconciliation is unavailable.",
      "UNAVAILABLE",
      503,
      { retryable: true, compatibilityFields: { ok: false } },
    );
  }
}
