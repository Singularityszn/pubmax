// Emoji reactions on a plan's public invite page. Same closed allowlist as
// pint-drop reactions (lib/reactions.ts REACTION_KEYS) and the same toggle
// shape as app/api/pint-drops/reactions/route.ts, keyed to a plan instead of
// a drop.

import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { isReactionKey } from "@/lib/reactions";
import { resolvePlanIdByInviteToken } from "@/lib/planStore";
import { UnknownPlanError, reactionStore } from "@/lib/planInviteRsvpStore";
import { hashActor } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

// Cheap toggles, generous budget — mirrors the pint-drop reactions route.
const REACTION_LIMIT = 40;
const REACTION_WINDOW_MS = 60_000;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const { token } = await params;
  const lookup = await resolvePlanIdByInviteToken(token);
  if (!lookup.ok) {
    return jsonNoStore({ error: "This invite is unavailable." }, { status: 503 });
  }
  if (!lookup.planId) {
    return jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const reaction = body.reaction;
  if (!isReactionKey(reaction)) return jsonNoStore({ error: "Unknown reaction." }, { status: 400 });

  const submitterHash = hashActor(readString(body.submitterId));
  if (
    await isLimited(`invite-reaction:${submitterHash}`, `invite-reaction:${submitterHash}`, REACTION_LIMIT, REACTION_WINDOW_MS)
  ) {
    return jsonNoStore({ error: "Too many reactions, slow down." }, { status: 429 });
  }

  try {
    const summary = await reactionStore().toggle(lookup.planId, submitterHash, reaction);
    return jsonNoStore({ summary }, { status: 200 });
  } catch (err) {
    if (err instanceof UnknownPlanError) {
      return jsonNoStore({ error: "This invite link isn't valid." }, { status: 404 });
    }
    console.error("[invite-reactions] POST failed:", err instanceof Error ? err.stack || err.message : err);
    return jsonNoStore({ error: "Reactions are unavailable." }, { status: 503 });
  }
}
