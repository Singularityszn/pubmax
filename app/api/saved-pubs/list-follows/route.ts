// Follow / unfollow another handle's named saved-pub list. Identity is still the
// self-asserted handle used by saved pubs, crawl authorship, and profile follows;
// this route does not pretend auth-backed ownership exists yet.

import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { normalizeHandle } from "@/lib/profiles";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  cleanListType,
  savedListFollowsStore,
  type SavedListFollowsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashIp, isSupabaseConfigured, requiresSupabaseStore } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

function store(): SavedListFollowsStore {
  return savedListFollowsStore();
}

function isSelfListFollow(followerHandle: string, ownerHandle: string): boolean {
  const follower = normalizeHandle(followerHandle);
  const owner = normalizeHandle(ownerHandle);
  return follower !== "" && follower === owner;
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const follower = normalizeHandle(params.get("follower") ?? "");
  const owner = normalizeHandle(params.get("owner") ?? "");
  const listType = cleanListType(params.get("listType"));

  try {
    if (owner && listType) {
      const [following, counts] = await Promise.all([
        follower ? store().isFollowingList(follower, owner, listType) : Promise.resolve(false),
        store().counts(owner, listType),
      ]);
      return jsonNoStore({ following, counts }, { status: 200 });
    }

    if (!follower) return jsonNoStore({ followedLists: [] }, { status: 200 });
    const followedLists = await store().listFollowedBy(follower);
    return jsonNoStore({ followedLists }, { status: 200 });
  } catch {
    // Fail-soft read: followed lists are additive social context, not a reason to
    // break the saved view/profile.
    return owner && listType
      ? jsonNoStore({ following: false, counts: { followers: 0, savedPubs: 0 } }, { status: 200 })
      : jsonNoStore({ followedLists: [] }, { status: 200 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonNoStore({ error: "Malformed request body." }, { status: 400 });
  }

  // JWT-linked handle wins over a self-asserted body.follower when signed in.
  const follower = await resolveMessageHandle(request, readString(body.follower));
  if (!follower) {
    return jsonNoStore(
      { error: "Set a handle first. Drop a pint to claim one." },
      { status: 400 },
    );
  }

  const owner = normalizeHandle(readString(body.owner) ?? "");
  if (!owner) return jsonNoStore({ error: "Missing list author." }, { status: 400 });

  const listType = cleanListType(body.listType);
  if (!listType) return jsonNoStore({ error: "A list name is required." }, { status: 400 });

  if (isSelfListFollow(follower, owner)) {
    return jsonNoStore({ error: "You can't follow your own list." }, { status: 400 });
  }

  const ownership = await gateHandleAction(request, follower);
  if (!ownership.allowed) {
    return jsonNoStore({ error: ownership.error }, { status: ownership.status });
  }

  const actorHash = hashIp(clientIp(request));
  if (await isLimited(`list-follow:${follower}`, `list-follow:${follower}:${actorHash}`)) {
    return jsonNoStore({ error: "Too many list follows, slow down." }, { status: 429 });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return jsonNoStore({ error: "List follow storage is not configured." }, { status: 503 });
  }

  const unfollow = readString(body.action) === "unfollow";
  try {
    const s = store();
    const following = unfollow
      ? !(await s.unfollowList(ownership.handle, owner, listType))
      : await s.followList(ownership.handle, owner, listType);
    const counts = await s.counts(owner, listType);
    return jsonNoStore({ following, counts }, { status: 200 });
  } catch {
    return jsonNoStore({ error: "List follow storage is unavailable." }, { status: 503 });
  }
}
