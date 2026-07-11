// GET /api/plans/[id]/getin — per-stop "can the crew get in?" estimate for a
// Plan. Read-only, link-visible (no auth), same 404 shape as GET
// /api/plans/[id]. Wraps lib/planGetIn's pure mapping around the real Plan
// state and venue detail lookup so every field stays an honest estimate —
// never a guarantee of entry.

import { jsonNoStore } from "@/lib/apiResponses";
import { planGetInReport } from "@/lib/planGetIn";
import { isPlanId } from "@/lib/plan";
import { planStore } from "@/lib/planStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { getVenueDetail } from "@/lib/venueDetailIndex";

assertServerEnv();
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  const plan = await planStore().get(id);
  if (!plan) return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  const report = await planGetInReport(plan, getVenueDetail);
  return jsonNoStore(report, { status: 200 });
}
