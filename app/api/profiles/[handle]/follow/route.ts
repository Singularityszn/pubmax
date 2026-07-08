// Follow / unfollow the profile at /u/[handle]. The follower is the self-asserted
// handle the client sends in the body (its localStorage `pubmax_handle`) — the
// same demo identity that authors a pint drop. Writes go through the service role
// (follows has no anon INSERT policy); the response echoes the new follow state
// and the target's fresh counts so the button + header update in one round trip.

import { jsonNoStore } from "@/lib/apiResponses";
import { emitNotification } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
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
  const target = normalizeHandle((await params).handle);
  if (!target) return jsonNoStore({ error: "Missing handle." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  const follower = normalizeHandle(readString(body.follower) ?? "");
  if (!follower) {
    return jsonNoStore(
      { error: "Set a handle first — drop a pint to claim one." },
      { status: 400 },
    );
  }
  if (isSelfFollow(follower, target)) {
    return jsonNoStore({ error: "You can't follow yourself." }, { status: 400 });
  }

  const ownership = await gateHandleAction(request, follower);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  // Rate-limit per follower + hashed IP so the follow graph can't be spammed.
  const key = `follow:${follower}:${hashIp(clientIp(request))}`;
  if (await isLimited(follower, key)) {
    return jsonNoStore({ error: "Too many follow changes, slow down." }, { status: 429 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "Follows storage is not configured." }, { status: 503 });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = followStore();
    const following = unfollow
      ? !(await s.unfollow(follower, target))
      : await s.follow(follower, target);
    // Emit seam (additive, best-effort): a NEW follow notifies the target. Never
    // awaited into the response path failure — emitNotification never throws and a
    // failed notification must never fail the follow write.
    if (!unfollow && following) {
      void emitNotification({
        recipientHandle: target,
        actorHandle: follower,
        kind: "follow",
        subjectRef: follower,
      });
    }
    const counts = await s.counts(target);
    return jsonNoStore({ following, counts }, { status: 200 });
  } catch {
    return jsonNoStore({ error: "Follow storage is unavailable." }, { status: 503 });
  }
}
