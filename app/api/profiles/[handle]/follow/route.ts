// Follow / unfollow the profile at /u/[handle]. The follower is the self-asserted
// handle the client sends in the body (its localStorage `pubmax_handle`) — the
// same demo identity that authors a pint drop. Writes go through the service role
// (follows has no anon INSERT policy); the response echoes the new follow state
// and the target's fresh counts so the button + header update in one round trip.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { followOnce } from "@/lib/followWrite.server";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { normalizeHandle } from "@/lib/profiles";
import { followStore, isSelfFollow } from "@/lib/followStore";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

assertServerEnv();

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  // Solo-operator emergency freeze (U15): changing the follow graph is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const target = normalizeHandle((await params).handle);
  if (!target) return publicApiError("Missing handle.", "INVALID_REQUEST", 400);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // JWT-linked handle wins over a self-asserted body.follower when signed in.
  const follower = await resolveMessageHandle(request, readString(body.follower));
  if (!follower) {
    return publicApiError("Choose a handle in your account first.", "INVALID_REQUEST", 400);
  }
  if (isSelfFollow(follower, target)) {
    return publicApiError("You can't follow yourself.", "INVALID_REQUEST", 400);
  }

  const ownership = await gateHandleAction(request, follower);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // Rate-limit per follower + hashed IP so the follow graph can't be spammed.
  const key = `follow:${follower}:${hashIp(clientIp(request))}`;
  if (await isLimited(follower, key)) {
    return publicApiError("Too many follow changes, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError("Follows storage is not configured.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = followStore();
    // `followOnce` is the shared write (lib/followWrite.server.ts): a starter
    // pack follows a dozen accounts through the same call, so idempotence and
    // the new-follow notification cannot differ between one tap and twelve.
    const following = unfollow
      ? !(await s.unfollow(follower, target))
      : (await followOnce(follower, target)) !== "self";
    const counts = await s.counts(target);
    return jsonNoStore({ following, counts }, { status: 200 });
  } catch {
    return publicApiError("Follow storage is unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }
}
