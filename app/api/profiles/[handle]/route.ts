// Public profile read seam for /u/[handle]. Returns the STORED profile row (or
// null when a handle has dropped no pints yet / Supabase is unconfigured), its
// follower/following counts, and — when a `?viewer=<handle>` is supplied — whether
// that viewer already follows this handle (drives the follow button's initial
// state without a second request).
//
// Store choice is the single seam pattern from app/api/pint-drops/route.ts:
// Supabase when configured, process-memory otherwise. Reads never 503 — a
// missing profile is a first-class "null" result, so the page always renders.

import { normalizeHandle } from "@/lib/profiles";
import { memoryProfileStore, supabaseProfileStore, type ProfileStore } from "@/lib/profileStore";
import { memoryFollowStore, supabaseFollowStore, type FollowStore } from "@/lib/followStore";
import { isSupabaseConfigured } from "@/lib/supabase";

function stores(): { profiles: ProfileStore; follows: FollowStore } {
  return isSupabaseConfigured()
    ? { profiles: supabaseProfileStore, follows: supabaseFollowStore }
    : { profiles: memoryProfileStore, follows: memoryFollowStore };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  const handle = normalizeHandle((await params).handle);
  if (!handle) {
    return Response.json({ error: "Missing handle." }, { status: 400 });
  }

  const { profiles, follows } = stores();
  const viewer = normalizeHandle(new URL(request.url).searchParams.get("viewer") ?? "");

  try {
    const [profile, counts] = await Promise.all([
      profiles.getByHandle(handle),
      follows.counts(handle),
    ]);
    // Only compute follow status for a *different* viewer — a handle never
    // "follows itself", and asking short-circuits to false.
    const viewerFollowing =
      viewer && viewer !== handle ? await follows.isFollowing(viewer, handle) : false;

    return Response.json({ profile, counts, viewerFollowing }, { status: 200 });
  } catch {
    // A backend hiccup degrades to the synthesized-profile path on the client —
    // return an empty-but-valid shape rather than an error the page must handle.
    return Response.json(
      { profile: null, counts: { followers: 0, following: 0 }, viewerFollowing: false },
      { status: 200 },
    );
  }
}
