// Handle-free RSVP on a plan's public invite page (Partiful-style: name +
// Going/Maybe, no account). POST is open to anyone holding the invite link.
// Host removal of a guest row lives under /api/plans/[id]/invite-rsvp so the
// path-scoped HttpOnly member cookie can authorize after a hard invite open.

import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { GUEST_DISPLAY_NAME_MAX, isRsvpStatus } from "@/lib/planInvite";
import { resolveClassicInvitePlan } from "@/lib/planInviteResolve";
import { RsvpCapExceededError, UnknownPlanError, rsvpStore } from "@/lib/planInviteRsvpStore";
import { hashActor } from "@/lib/supabase";
import { cleanText, readString } from "@/lib/textClean";

const RSVP_LIMIT = 8;
const RSVP_WINDOW_MS = 60_000;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { token } = await params;
  const resolved = await resolveClassicInvitePlan(token);
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

  const submitterId = readString(body.submitterId);
  if (!submitterId) return jsonNoStore({ error: "Couldn't save that RSVP." }, { status: 400 });
  const submitterHash = hashActor(submitterId);
  const tokenHash = hashActor(token);
  // Per-device and per-invite budgets: rotating submitterId alone must not flood one guest list.
  if (
    (await isLimited(`invite-rsvp:${submitterHash}`, `invite-rsvp:${submitterHash}`, RSVP_LIMIT, RSVP_WINDOW_MS)) ||
    (await isLimited(`invite-rsvp-token:${tokenHash}`, `invite-rsvp-token:${tokenHash}`, RSVP_LIMIT * 4, RSVP_WINDOW_MS))
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
    if (err instanceof RsvpCapExceededError) {
      return jsonNoStore({ error: "This guest list is full." }, { status: 409 });
    }
    console.error("[invite-rsvp] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return jsonNoStore({ error: "RSVPs are unavailable." }, { status: 503 });
  }
}
