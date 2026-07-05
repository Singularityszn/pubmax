// Follow / unfollow the profile at /u/[handle]. The follower is the self-asserted
// handle the client sends in the body (its localStorage `pubmax_handle`) — the
// same demo identity that authors a pint drop. Writes go through the service role
// (follows has no anon INSERT policy); the response echoes the new follow state
// and the target's fresh counts so the button + header update in one round trip.

import { isLimited } from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { isSelfFollow, memoryFollowStore, supabaseFollowStore, type FollowStore } from "@/lib/followStore";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";

function store(): FollowStore {
  return isSupabaseConfigured() ? supabaseFollowStore : memoryFollowStore;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const target = normalizeHandle((await params).handle);
  if (!target) return Response.json({ error: "Missing handle." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Malformed request body." }, { status: 400 });
  }

  const follower = normalizeHandle(readString(body.follower) ?? "");
  if (!follower) {
    return Response.json(
      { error: "Set a handle first — drop a pint to claim one." },
      { status: 400 },
    );
  }
  if (isSelfFollow(follower, target)) {
    return Response.json({ error: "You can't follow yourself." }, { status: 400 });
  }

  // Rate-limit per follower + hashed IP so the follow graph can't be spammed.
  const key = `follow:${follower}:${hashIp(clientIp(request))}`;
  if (await isLimited(follower, key)) {
    return Response.json({ error: "Too many follow changes, slow down." }, { status: 429 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return Response.json({ error: "Follows storage is not configured." }, { status: 503 });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = store();
    const following = unfollow
      ? !(await s.unfollow(follower, target))
      : await s.follow(follower, target);
    const counts = await s.counts(target);
    return Response.json({ following, counts }, { status: 200 });
  } catch {
    return Response.json({ error: "Follow storage is unavailable." }, { status: 503 });
  }
}
