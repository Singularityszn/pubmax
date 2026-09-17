import "server-only";

// Server-only by construction: it imports the profile and follow stores, so it
// can never end up in a client bundle.

import { accountIsPrivate } from "@/lib/accountVisibility";
import { callerUserId } from "@/lib/authServer";
import { isMutual, resolveFollowRelation } from "@/lib/followRelation";
import { followStore, type FollowStore } from "@/lib/followStore";
import { normalizeHandle } from "@/lib/profiles";
import {
  fullProfileProjection,
  limitedProfileProjection,
  profileProjectionKind,
  type ProfileViewerRelation,
  type ProfileVisibilityProjection,
} from "@/lib/profileVisibility";
import {
  profileStore,
  publicProfileFromRecord,
  type ProfileRecord,
  type ProfileStore,
} from "@/lib/profileStore";

/**
 * Sole server seam that decides whether a request may receive an account's full
 * public card or only the limited one. It is the profile twin of
 * `resolvePlanProjection`, and it copies that seam's two rules deliberately.
 *
 * IT READS NO ENVIRONMENT VARIABLE. A privacy answer that a deployment can
 * change is a privacy answer nobody can rely on, which is exactly what D01 cost
 * the Plan boundary: the member projection sat behind a rollout flag CI set and
 * no deployment did, so production answered the preview to every reader.
 * `__tests__/profileVisibilityBoundary.test.ts` reads this file's own source and
 * fails on any environment read appearing in it.
 *
 * IT FAILS CLOSED. The full card is answered only when the account is public,
 * or when the request carries a bearer that verifies to the owner of this
 * profile or to an account this profile is mates with. No bearer, an invalid or
 * unverifiable one, a store error on either side, or an account with no handle
 * of its own each degrade to the limited card. So the limited card has no
 * switch either: nothing can turn it off for a stranger, and nothing can turn a
 * mate into one.
 *
 * A PUBLIC ACCOUNT COSTS NOTHING. The cheap synchronous question is asked
 * first, so the ordinary read of the ordinary account verifies no bearer, reads
 * no follow edge and adds no round trip at all.
 *
 * IDENTITY COMES FROM THE BEARER, NEVER FROM `?viewer=`. That query parameter
 * is the follow button's own convenience and is self-asserted, so it may decide
 * what a control SAYS and never what a body CARRIES: a caller could type
 * anybody's handle into it.
 */

type VerifyCaller = (request: Request) => Promise<string | null>;

export type ResolveProfileProjectionInput = {
  request: Request;
  /** The stored row for the handle being read, or null when it has none. */
  profile: ProfileRecord | null | undefined;
  /**
   * The cover rotation, read ONLY on the full lane. A limited card carries no
   * backdrop, so a private profile a stranger opened must not pay a second
   * store read for photographs it will not be handed.
   */
  readCoverUrls?: () => Promise<readonly string[] | undefined>;
  /** Test seams. Each defaults to the real thing. */
  verifyCaller?: VerifyCaller;
  profiles?: Pick<ProfileStore, "getHandleByUserId">;
  follows?: Pick<FollowStore, "isFollowing">;
};

/**
 * What the caller of this request is to `profile`. Every failure answers
 * `stranger`, which is the whole of the fail-closed rule.
 */
async function resolveViewerRelation(input: {
  request: Request;
  profile: ProfileRecord;
  verifyCaller: VerifyCaller;
  profiles: Pick<ProfileStore, "getHandleByUserId">;
  follows: Pick<FollowStore, "isFollowing">;
}): Promise<ProfileViewerRelation> {
  let viewerUserId: string | null;
  try {
    viewerUserId = await input.verifyCaller(input.request);
  } catch {
    return "stranger";
  }
  const viewer = viewerUserId?.trim() || null;
  if (!viewer) return "stranger";

  // Ownership is the stored column, never the handle text. A handle a caller
  // typed proves nothing (the messaging-channel finding F-1 is the same rule),
  // and `getHandleByUserId` answers off `profiles.user_id`, so a match there is
  // evidence from the ownership column rather than from a word.
  const owner = input.profile.userId?.trim() || null;
  if (owner && viewer === owner) return "owner";

  let viewerHandle = "";
  try {
    viewerHandle = normalizeHandle((await input.profiles.getHandleByUserId(viewer)) ?? "");
  } catch {
    return "stranger";
  }
  if (!viewerHandle) return "stranger";

  // A LOT IS MUTUAL, and that is the whole of the approved relation. Both edges
  // are read because one alone cannot tell "mates" from "follows you", and
  // `lib/followRelation.ts` stays the only place that word is decided.
  try {
    const [viewerFollowing, followsViewer] = await Promise.all([
      input.follows.isFollowing(viewerHandle, input.profile.handle),
      input.follows.isFollowing(input.profile.handle, viewerHandle),
    ]);
    return isMutual(resolveFollowRelation({ viewerFollowing, followsViewer }))
      ? "mate"
      : "stranger";
  } catch {
    return "stranger";
  }
}

export async function resolveProfileProjection({
  request,
  profile,
  readCoverUrls,
  verifyCaller = callerUserId,
  profiles,
  follows,
}: ResolveProfileProjectionInput): Promise<ProfileVisibilityProjection> {
  // No row is no card. Nothing is withheld and nothing is claimed: a handle
  // nobody owns may not be reported as a private account.
  if (!profile) return fullProfileProjection(null);

  if (!accountIsPrivate(profile.visibility)) {
    const coverUrls = await readCoverUrls?.();
    return fullProfileProjection(
      publicProfileFromRecord(profile, coverUrls ? { coverUrls } : {}),
    );
  }

  const relation = await resolveViewerRelation({
    request,
    profile,
    verifyCaller,
    profiles: profiles ?? profileStore(),
    follows: follows ?? followStore(),
  });

  if (profileProjectionKind({ visibility: "private", relation }) === "limited") {
    const card = publicProfileFromRecord(profile);
    return card ? limitedProfileProjection(card) : fullProfileProjection(null);
  }

  const coverUrls = await readCoverUrls?.();
  return fullProfileProjection(
    publicProfileFromRecord(profile, coverUrls ? { coverUrls } : {}),
  );
}
