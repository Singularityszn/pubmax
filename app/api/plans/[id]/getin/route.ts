// GET /api/plans/[id]/getin gives Plan members per-stop entry estimates.
// Other viewers receive a preview marker without venue data. The report uses
// Plan state and venue details, but cannot guarantee entry.
//
// This read must not send notifications. Plan targeting restrictions belong
// to docs/WEB_PUSH.md#night-signal-broadcasts.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { planGetInReport } from "@/lib/planGetIn";
import { isPlanId } from "@/lib/plan";
import { resolvePlanProjection } from "@/lib/planPrivacyBoundary.server";
import { planStateResult } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { getVenueDetail } from "@/lib/venueDetailIndex";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const lookup = await planStateResult(id);
  if (!lookup.ok) return publicApiError("Plan data is temporarily unavailable.", "PLAN_STORE_UNAVAILABLE", 503, { retryable: true });
  if (!lookup.plan) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  // The get-in report names every Venue on the route, so it is member-only.
  // Uninvited viewers get a preview marker, never the per-stop venue data.
  const projection = await resolvePlanProjection({ request, planId: id, state: lookup.plan });
  if (projection.visibility !== "member") {
    return jsonNoStore({ visibility: "preview" }, { status: 200 });
  }
  const report = await planGetInReport(lookup.plan, getVenueDetail);
  return jsonNoStore(report, { status: 200 });
}
