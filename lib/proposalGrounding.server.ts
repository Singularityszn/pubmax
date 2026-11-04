import "server-only";

import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { proposalPreservesNight } from "@/lib/slidingDoors";
import { readPlanGroundingClaims, verifyPlanGroundingProof, verifyAnchoredPlanGroundingProofV2 } from "@/lib/planGrounding.server";

export type ProposalGrounding = {
  proof: string;
  operationKey: string;
  expiresAt: string;
  anchorVenueId: string | null;
  anchorSource: string | null;
};

export function checkProposalGrounding(
  state: PlanState,
  stops: readonly PlanStopDTO[],
  proof: unknown,
  operationKey: unknown,
  now = Date.now(),
): { ok: true; grounding: ProposalGrounding | null } | { ok: false; error: "invalid" | "expired" | "forbidden" } {
  if (!proposalPreservesNight(state, stops)) return { ok: false, error: "forbidden" };
  if (!proof && !state.plan.anchorVenueId) return { ok: true, grounding: null };
  if (typeof proof !== "string" || proof.length > 8_000 || typeof operationKey !== "string" || operationKey.length < 8 || operationKey.length > 120) return { ok: false, error: "forbidden" };
  const ids = stops.map((stop) => stop.venueId);
  const verdict = verifyAnchoredPlanGroundingProofV2(proof, ids, operationKey, now);
  if (verdict.ok) {
    if (verdict.outcome !== "route" || verdict.anchorVenueId !== (state.plan.anchorVenueId ?? null)
      || verdict.anchorSource !== (state.plan.anchorSource ?? null)) return { ok: false, error: "forbidden" };
    return { ok: true, grounding: { proof, operationKey, expiresAt: new Date(verdict.expiresAt).toISOString(), anchorVenueId: verdict.anchorVenueId, anchorSource: verdict.anchorSource } };
  }
  if (verdict.reason === "expired") return { ok: false, error: "expired" };
  if (!state.plan.anchorVenueId) {
    const claims = readPlanGroundingClaims(proof, ids, operationKey);
    if (claims && verifyPlanGroundingProof(proof, ids, operationKey, now)) {
      return { ok: true, grounding: { proof, operationKey, expiresAt: new Date(claims.expiresAt).toISOString(), anchorVenueId: null, anchorSource: null } };
    }
    if (claims && claims.expiresAt < now) return { ok: false, error: "expired" };
  }
  return { ok: false, error: "forbidden" };
}
