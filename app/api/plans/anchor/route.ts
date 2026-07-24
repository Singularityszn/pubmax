// GET /api/plans/anchor — canonical planning-anchor preflight. Turns a client's
// accepted-Venue reference into a privacy-safe display projection or a
// machine-readable conflict via the single server seam resolvePlanningAnchor.
// It is READ-ONLY: it mints no proof, records no location, and creates no Plan.
// The canonical machine context stays server-side and feeds anchored generation
// directly, so it never crosses the wire here.
//
// Gated on PUBMAX_ANCHORED_GENERATION: while off there is no anchored surface,
// so the route reports 404 and the accepted Venue simply stays provisional.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { parseCityId } from "@/lib/cities";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import { resolvePlanningAnchor } from "@/lib/planningAnchor.server";
import type { PlanningIntentArea } from "@/lib/planningIntent";
import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

function parseAcceptedArea(params: URLSearchParams): PlanningIntentArea | undefined {
  const kind = params.get("areaKind");
  if (kind === null || kind === "" || kind === "none") return null;
  if (kind === "night-patch") {
    const id = params.get("areaId");
    return id && NIGHT_PATCHES.some((patch) => patch.id === id)
      ? { kind: "night-patch", id: id as NightPatchId }
      : undefined;
  }
  if (kind === "borough") {
    const name = params.get("areaName");
    return name && LONDON_BOROUGHS.includes(name) ? { kind: "borough", name } : undefined;
  }
  return undefined;
}

export async function GET(request: Request): Promise<Response> {
  if (!readTrustedHandoffFlag("anchoredGeneration")) {
    return publicApiError("Anchored planning is not available.", "PLAN_ANCHOR_DISABLED", 404);
  }

  const params = new URL(request.url).searchParams;

  const cityId = parseCityId(params.get("cityId"));
  if (!cityId) return publicApiError("Include a supported city.", "PLAN_ANCHOR_BAD_REQUEST", 400);

  const venueId = params.get("venueId");
  if (!venueId || !venueId.trim()) {
    return publicApiError("Include the accepted Venue.", "PLAN_ANCHOR_BAD_REQUEST", 400);
  }

  const startsAtParam = params.get("startsAt");
  const startsAt = startsAtParam === null || startsAtParam === "" ? null : startsAtParam;

  const acceptedArea = parseAcceptedArea(params);
  if (acceptedArea === undefined) {
    return publicApiError("Send a supported accepted area or none.", "PLAN_ANCHOR_BAD_REQUEST", 400);
  }

  const budgetParam = params.get("budgetPerPersonPence");
  const budgetPerPersonPence = budgetParam === null || budgetParam === ""
    ? null
    : Number.isFinite(Number(budgetParam)) && Number.isInteger(Number(budgetParam)) && Number(budgetParam) >= 0
      ? Number(budgetParam)
      : undefined;
  if (budgetPerPersonPence === undefined) {
    return publicApiError("Send budgetPerPersonPence as a non-negative integer.", "PLAN_ANCHOR_BAD_REQUEST", 400);
  }

  const accessParam = params.get("requiresStepFreeAccess");
  const requiresStepFreeAccess = accessParam === "1" || accessParam === "true" ? true : undefined;

  const result = await resolvePlanningAnchor({
    cityId,
    venueId,
    startsAt,
    acceptedArea,
    budgetPerPersonPence,
    requiresStepFreeAccess,
  });

  if (result.status === "conflict") {
    return jsonNoStore({ status: "conflict", code: result.code, message: result.message }, { status: 200 });
  }
  // Only the privacy-safe display projection crosses the wire.
  return jsonNoStore({ status: "resolved", display: result.display }, { status: 200 });
}
