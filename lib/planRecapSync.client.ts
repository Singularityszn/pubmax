import { authedFetch } from "@/lib/authedFetch";
import type { PendingPlanRecap } from "@/lib/planRecap";
import { validatePendingPlanRecap } from "@/lib/planRecap";

/**
 * Best-effort park of a device draft under the signed-in owner scope so a
 * reload on this account can resume. Unsigned callers get a quiet 401; the
 * local draft remains the source of truth until claim or save.
 */
export async function syncPendingPlanRecapToAccount(
  recap: PendingPlanRecap,
  signal?: AbortSignal,
): Promise<boolean> {
  const safe = validatePendingPlanRecap(recap);
  if (!safe) return false;
  try {
    const response = await authedFetch("/api/me/pending-plan-recaps", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recap: safe }),
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
}
