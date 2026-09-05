import "server-only";

// Server-only by construction: it imports planStore, so it can never end up in
// a client bundle.

import type { PlanState } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import {
  buildPlanPrivacyPreview,
  memberProjection,
  type PlanVisibilityProjection,
} from "@/lib/planPrivacy";
import { planMemberIdentityResult } from "@/lib/planStore";
import type { VibeTally } from "@/lib/vibeTally";

/**
 * Sole server seam that decides whether a request may receive the full Plan
 * state or only the anonymous preview (§4.10). A CAPABILITY IS THE WHOLE
 * QUESTION, and there is no second one: the member projection used to sit
 * behind a rollout switch as well, and a deployment without it answered the
 * preview to every reader, so a host who had just locked a plan read "You've
 * been invited" on their own plan, a joined guest never saw the route and the
 * host never saw who joined (D01, core-loop battle test, 5 Sep 2026).
 *
 * It still fails CLOSED. The member projection is returned only when the
 * request carries a capability that resolves to an active host/guest identity;
 * no capability, a store error, or a missing, expired, revoked or wrong-plan
 * identity each degrade to the preview. The privacy-safe preview therefore has
 * no switch either: nothing can turn it off for a stranger, and nothing can
 * turn a member into one.
 */

type IdentityLookup = typeof planMemberIdentityResult;

export type ResolvePlanProjectionInput = {
  request: Request;
  planId: string;
  state: PlanState;
  vibeTally?: VibeTally | null;
  /** Test seam only; defaults to the real store lookup. */
  identityLookup?: IdentityLookup;
};

export async function resolvePlanProjection({
  request,
  planId,
  state,
  vibeTally = null,
  identityLookup = planMemberIdentityResult,
}: ResolvePlanProjectionInput): Promise<PlanVisibilityProjection> {
  const preview = () => buildPlanPrivacyPreview(state, vibeTally);

  const token = planMemberCapability(request, undefined);
  if (!token) return preview();

  let identity: Awaited<ReturnType<IdentityLookup>>;
  try {
    identity = await identityLookup(planId, token);
  } catch {
    // Any lookup failure is treated as unauthenticated — never leak on error.
    return preview();
  }
  if (!identity.ok || !identity.identity) return preview();

  return memberProjection(state);
}
