// Host-only RSVP moderation for a plan's public invite guest list.
// Lives under /api/plans/[id]/… so the path-scoped HttpOnly member cookie
// (Path=/api/plans/${planId}) is sent and planMemberCapability can restore
// host authority after a hard navigation to /invite/[token]. The public
// guest write path stays on /api/invite/[token]/rsvp.

import { jsonNoStore } from "@/lib/apiResponses";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentity, planStateResult } from "@/lib/planStore";
import { rsvpStore } from "@/lib/planInviteRsvpStore";
import { readString } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `plan-invite-rsvp:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { id: planId } = await context.params;
  if (!isPlanId(planId)) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }

  const state = await planStateResult(planId);
  if (!state.ok) {
    return publicApiError("Couldn't remove that RSVP.", "PLAN_INVITE_RSVP_UNAVAILABLE", 503, { retryable: true });
  }
  if (!state.plan) {
    return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const rsvpId = readString(body.rsvpId);
  if (!rsvpId) return publicApiError("Missing RSVP id.", "PLAN_INVITE_RSVP_MISSING_ID", 400);

  const memberToken = planMemberCapability(request, body.memberToken);
  const identity = await planMemberIdentity(planId, memberToken);
  if (!identity || identity.role !== "host") {
    return publicApiError("Only the host can remove an RSVP.", "PLAN_INVITE_RSVP_FORBIDDEN", 403);
  }

  try {
    await rsvpStore().remove(planId, rsvpId);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[plan-invite-rsvp] DELETE failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Couldn't remove that RSVP.", "PLAN_INVITE_RSVP_UNAVAILABLE", 503, { retryable: true });
  }
}
