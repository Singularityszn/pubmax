// Host-only RSVP moderation for a plan's public invite guest list.
// Lives under /api/plans/[id]/… so the path-scoped HttpOnly member cookie
// (Path=/api/plans/${planId}) is sent and planMemberCapability can restore
// host authority after a hard navigation to /invite/[token]. The public
// guest write path stays on /api/invite/[token]/rsvp.

import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isPlanId } from "@/lib/plan";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentity, planStateResult } from "@/lib/planStore";
import { rsvpStore } from "@/lib/planInviteRsvpStore";
import { readString } from "@/lib/textClean";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { id: planId } = await context.params;
  if (!isPlanId(planId)) {
    return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  }

  const state = await planStateResult(planId);
  if (!state.ok) {
    return jsonNoStore({ error: "Couldn't remove that RSVP." }, { status: 503 });
  }
  if (!state.plan) {
    return jsonNoStore({ error: "That Plan doesn't exist." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const rsvpId = readString(body.rsvpId);
  if (!rsvpId) return jsonNoStore({ error: "Missing RSVP id." }, { status: 400 });

  const memberToken = planMemberCapability(request, body.memberToken);
  const identity = await planMemberIdentity(planId, memberToken);
  if (!identity || identity.role !== "host") {
    return jsonNoStore({ error: "Only the host can remove an RSVP." }, { status: 403 });
  }

  try {
    await rsvpStore().remove(planId, rsvpId);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[plan-invite-rsvp] DELETE failed:", err instanceof Error ? err.stack || err.message : err);
    return jsonNoStore({ error: "Couldn't remove that RSVP." }, { status: 503 });
  }
}
