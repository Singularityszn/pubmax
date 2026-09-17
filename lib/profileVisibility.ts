// The canonical account-visibility projection: one pure place that decides what
// a reader who is NOT a private account's owner or mate may see of it.
//
// It is the profile half of the shape `lib/planPrivacy.ts` already holds for a
// Plan, and it is deliberately built the same way: a discriminated pair of
// projections, a pure builder for each, and a `projection` field a surface can
// branch on without re-deriving the decision. The server picks between them at
// exactly one seam (`lib/profileVisibilityBoundary.server.ts`); nothing else in
// the tree may decide this.
//
// THE LIMITED CARD IS AN ALLOW LIST, NEVER A DENY LIST. `limitedProfileCard`
// names the fields that travel and copies only those, so a field added to
// `PublicProfile` tomorrow is withheld from a private account by DEFAULT and
// joins the card only when somebody puts it there on purpose. A deny list is
// how the next public field leaks: it is the same defect a second copy of
// `toPublicProfile`'s field list already caused once, when it dropped a
// founding member's brass mark off an avatar write.
//
// Pure and isomorphic on purpose, so the seam, the route tests and a browser
// surface all read one rule with no DOM, no request and no store.

import { accountIsPrivate, type AccountVisibility } from "@/lib/accountVisibility";
import type { PublicProfile } from "@/lib/profiles";

/**
 * What one account is to a private one, for the purpose of this decision. It is
 * deliberately NARROWER than `lib/followRelation.ts`'s four-word graph state:
 * that module still owns what "mates" means, and this one owns only the three
 * answers a projection turns on.
 *
 * There is no fourth answer, and in particular there is no pending FOLLOW
 * REQUEST: this product's approved relation is the mutual follow it already
 * calls a lot, and inventing a request queue here would be a second membership
 * model beside the one the copy already promises.
 */
export const PROFILE_VIEWER_RELATIONS = ["owner", "mate", "stranger"] as const;

export type ProfileViewerRelation = (typeof PROFILE_VIEWER_RELATIONS)[number];

export type ProfileProjectionKind = "full" | "limited";

/**
 * The closed set of `PublicProfile` keys a private account's card carries to a
 * reader who is neither its owner nor its mate.
 *
 * The handle, the name and the face stay because a friend has to be able to
 * recognise the person they came to add, and because they are already published
 * for every claimed account through the follow lists and the people directory
 * (`ProfilePublicCard`): withholding them here alone would take nothing away
 * and would make a private card unrecognisable to the friend it is for.
 *
 * The founding number stays for the reason `toPublicProfile` gives for keeping
 * it: it is printed on a public wall at `/founders` and answered by
 * `/api/founding-members`, so hiding it here would only mean the card asked
 * twice for something already published.
 *
 * `createdAt` and `updatedAt` stay because the type needs them and neither is
 * content: they date the row, not what is in it.
 */
export const LIMITED_PROFILE_CARD_FIELDS = [
  "id",
  "handle",
  "displayName",
  "avatarUrl",
  "foundingMemberNumber",
  "visibility",
  "createdAt",
  "updatedAt",
] as const satisfies readonly (keyof PublicProfile)[];

/**
 * What a private account withholds, named for the copy and for the fence. The
 * list is documentation and a test target; the ALLOW list above is what the
 * code actually applies.
 */
export const PROFILE_FIELDS_WITHHELD_WHEN_PRIVATE = [
  "bio",
  "homeCity",
  "favouriteDrink",
  "interests",
  "workplace",
  "coverUrl",
  "coverUrls",
] as const satisfies readonly (keyof PublicProfile)[];

/**
 * Which projection a reader gets. A public account answers the full card to
 * everybody, exactly as it always has; a private one answers the full card to
 * its owner and to a mate, and the limited card to everybody else.
 */
export function profileProjectionKind(input: {
  visibility: AccountVisibility;
  relation: ProfileViewerRelation;
}): ProfileProjectionKind {
  if (!accountIsPrivate(input.visibility)) return "full";
  return input.relation === "stranger" ? "limited" : "full";
}

/**
 * The full card, or null when the handle has no stored row at all. A missing
 * row is not a private account: there is no card to withhold and reporting one
 * as private would name an account that is not there.
 */
export type ProfileFullProjection = {
  projection: "full";
  profile: PublicProfile | null;
};

/** The limited card. Always a real profile: there is a row, it just says less. */
export type ProfileLimitedProjection = {
  projection: "limited";
  profile: PublicProfile;
};

export type ProfileVisibilityProjection =
  | ProfileFullProjection
  | ProfileLimitedProjection;

/** Narrow a full card down to {@link LIMITED_PROFILE_CARD_FIELDS}. */
export function limitedProfileCard(profile: PublicProfile): PublicProfile {
  return {
    id: profile.id,
    handle: profile.handle,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    ...(profile.foundingMemberNumber !== undefined
      ? { foundingMemberNumber: profile.foundingMemberNumber }
      : {}),
    visibility: profile.visibility,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function fullProfileProjection(
  profile: PublicProfile | null,
): ProfileFullProjection {
  return { projection: "full", profile };
}

export function limitedProfileProjection(
  profile: PublicProfile,
): ProfileLimitedProjection {
  return { projection: "limited", profile: limitedProfileCard(profile) };
}

/**
 * A body the server answered as the limited card rather than the full one.
 *
 * It lives beside the projection it reads for the reason
 * `isPlanPreviewProjection` does: a limited answer is an ANSWER, so a surface
 * holding a full card must put it down when a later read comes back this way,
 * and a second copy of the discriminant is how one surface keeps showing what
 * the server already withheld.
 */
export function isLimitedProfileProjection(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { projection?: unknown }).projection === "limited"
  );
}

/**
 * Whether the linked socials travel with this projection. They are public by
 * choice on a public account and are the one public addition to the profile
 * read, so they are exactly as private as the bio beside them.
 */
export function projectionCarriesSocialLinks(
  projection: ProfileProjectionKind,
): boolean {
  return projection === "full";
}
