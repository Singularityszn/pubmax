// Emoji reactions on a plan's public invite page. Same closed allowlist as
// pint-drop reactions (lib/reactions.ts REACTION_KEYS) and the same toggle
// shape as app/api/pint-drops/reactions/route.ts, keyed to a plan instead of
// a drop. GET hydrates "mine" for the device's anon id after SSR (which has
// no device id and therefore ships empty mine).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { resolveClassicInvitePlan } from "@/lib/planInviteResolve";
import { UnknownPlanError, reactionStore } from "@/lib/planInviteRsvpStore";
import { isReactionKey } from "@/lib/reactions";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

const REACTION_LIMIT = 40;
const REACTION_WINDOW_MS = 60_000;
// submitterId comes from the body, so rotating it is a fresh submitter budget
// every time. Like the RSVP route, an IP budget and a per-invite budget sit
// beside it, so one caller cannot inflate one plan's counts without bound.
const REACTION_IP_LIMIT = 60;
const REACTION_TOKEN_LIMIT = REACTION_LIMIT * 4;
const REACTION_READ_IP_LIMIT = 120;

function tooMany(): Response {
  return publicApiError("Too many reactions, slow down.", "RATE_LIMITED", 429, { retryable: true });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const readKey = `invite-reaction-read:${hashIp(clientIp(request))}`;
  if (await isLimited(readKey, readKey, REACTION_READ_IP_LIMIT, REACTION_WINDOW_MS)) return tooMany();

  const { token } = await params;
  const resolved = await resolveClassicInvitePlan(token);
  if ("response" in resolved) return resolved.response;

  const submitterId = new URL(request.url).searchParams.get("submitterId")?.trim() ?? "";
  if (!submitterId) return publicApiError("Missing submitter.", "INVALID_REQUEST", 400);

  try {
    const summary = await reactionStore().summarize(resolved.planId, hashActor(submitterId));
    return jsonNoStore({ summary }, { status: 200 });
  } catch (err) {
    console.error("[invite-reactions] GET failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Reactions are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const ipKey = `invite-reaction-ip:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, REACTION_IP_LIMIT, REACTION_WINDOW_MS)) return tooMany();

  const { token } = await params;
  const resolved = await resolveClassicInvitePlan(token);
  if ("response" in resolved) return resolved.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const reaction = body.reaction;
  if (!isReactionKey(reaction)) return publicApiError("Unknown reaction.", "INVALID_REQUEST", 400);

  const submitterId = readString(body.submitterId);
  if (!submitterId) return publicApiError("Couldn't save that reaction.", "INVALID_REQUEST", 400);
  const submitterHash = hashActor(submitterId);
  const tokenHash = hashActor(token);
  if (
    (await isLimited(`invite-reaction:${submitterHash}`, `invite-reaction:${submitterHash}`, REACTION_LIMIT, REACTION_WINDOW_MS)) ||
    (await isLimited(`invite-reaction-token:${tokenHash}`, `invite-reaction-token:${tokenHash}`, REACTION_TOKEN_LIMIT, REACTION_WINDOW_MS))
  ) {
    return tooMany();
  }

  try {
    const summary = await reactionStore().toggle(resolved.planId, submitterHash, reaction);
    return jsonNoStore({ summary }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownPlanError) {
      return publicApiError("This invite link isn't valid.", "NOT_FOUND", 404);
    }
    console.error("[invite-reactions] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return publicApiError("Reactions are unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}
