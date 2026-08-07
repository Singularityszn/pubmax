// Handle-free RSVP on a plan's public invite page (Partiful-style: name +
// Going/Maybe, no account). POST is open to anyone holding the invite link;
// DELETE is host-only (participant-fenced, ruling 4's moderation clause) so a
// host can remove a joke or spam entry from their own guest list.
//
// The submitter is identified only by a hashed device id (lib/anonId.ts on
// the client, hashActor here) — never a raw id, never a handle. A resubmit
// from the same device UPDATES that guest's row (plan_invite_rsvps'
// unique(plan_id, submitter_hash)), so changing Going to Maybe never stacks.

import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { GUEST_DISPLAY_NAME_MAX, isRsvpStatus } from "@/lib/planInvite";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { planMemberIdentity, resolvePlanIdByInviteToken } from "@/lib/planStore";
import { UnknownPlanError, rsvpStore } from "@/lib/planInviteRsvpStore";
import { hashActor } from "@/lib/supabase";
import { cleanText, readString } from "@/lib/textClean";

// Handle-free RSVP is easy to spam faster than a normal comment, so the
// budget is tighter than the reactions route's generous toggle allowance.
const RSVP_LIMIT = 8;
const RSVP_WINDOW_MS = 60_000;

async function resolvePlanId(token: string): Promise<{ planId: string } | { response: Response }> {
  const lookup = await resolvePlanIdByInviteToken(token);
  if (!lookup.ok) {
    return { response: jsonNoStore({ error: "This invite is unavailable." }, { status: 503 }) };
  }
  if (!lookup.planId) {
    return { response: jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 }) };
  }
  return { planId: lookup.planId };
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { token } = await params;
  const resolved = await resolvePlanId(token);
  if ("response" in resolved) return resolved.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const displayName = cleanText(readString(body.displayName), GUEST_DISPLAY_NAME_MAX);
  const status = body.status;
  if (!displayName) return jsonNoStore({ error: "Add a name to RSVP." }, { status: 400 });
  if (!isRsvpStatus(status)) return jsonNoStore({ error: "Choose Going or Maybe." }, { status: 400 });

  const submitterHash = hashActor(readString(body.submitterId));
  if (
    await isLimited(`invite-rsvp:${submitterHash}`, `invite-rsvp:${submitterHash}`, RSVP_LIMIT, RSVP_WINDOW_MS)
  ) {
    return jsonNoStore({ error: "Too many RSVPs, slow down." }, { status: 429 });
  }

  try {
    const summary = await rsvpStore().upsert(resolved.planId, submitterHash, displayName, status);
    return jsonNoStore({ summary }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownPlanError) {
      return jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 });
    }
    console.error("[invite-rsvp] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return jsonNoStore({ error: "RSVPs are unavailable." }, { status: 503 });
  }
}

/** Host-only removal of one guest's RSVP row. Freeze-gated like any other social write. */
export async function DELETE(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { token } = await params;
  const resolved = await resolvePlanId(token);
  if ("response" in resolved) return resolved.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const rsvpId = readString(body.rsvpId);
  if (!rsvpId) return jsonNoStore({ error: "Missing RSVP id." }, { status: 400 });

  const memberToken = planMemberCapability(request, body.memberToken);
  const identity = await planMemberIdentity(resolved.planId, memberToken);
  if (!identity || identity.role !== "host") {
    return jsonNoStore({ error: "Only the host can remove an RSVP." }, { status: 403 });
  }

  try {
    await rsvpStore().remove(resolved.planId, rsvpId);
    return jsonNoStore({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[invite-rsvp] DELETE failed:", err instanceof Error ? err.stack || err.message : err);
    return jsonNoStore({ error: "Couldn't remove that RSVP." }, { status: 503 });
  }
}
