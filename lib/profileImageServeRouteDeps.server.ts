import "server-only";

import {
  defaultProfileImageServeDeps,
  PROFILE_IMAGE_SERVE_CACHE_CONTROL,
  type CoverReadRefusal,
  type ProfileImageServeDeps,
} from "@/lib/profileImageServe.server";
import { profileCoverPhotoStore } from "@/lib/profileCoverPhotoStore";
import { isReportedImageQueueRow, profileImageState, type ProfileRecord } from "@/lib/profileStore";

export const AVATAR_SERVE_CACHE_CONTROL = PROFILE_IMAGE_SERVE_CACHE_CONTROL;

let avatarTestDeps: Partial<ProfileImageServeDeps> | null = null;
let coverTestDeps: Partial<ProfileImageServeDeps> | null = null;

export function __setAvatarServeRouteDepsForTest(
  deps: Partial<ProfileImageServeDeps> | null,
): void {
  avatarTestDeps = deps;
}

export function __setCoverServeRouteDepsForTest(
  deps: Partial<ProfileImageServeDeps> | null,
): void {
  coverTestDeps = deps;
}

export function avatarServeRouteDeps(): ProfileImageServeDeps {
  return { ...defaultProfileImageServeDeps, ...avatarTestDeps };
}

export function coverServeRouteDeps(): ProfileImageServeDeps {
  return {
    ...defaultProfileImageServeDeps,
    // A profile holds up to five covers and the row names only the first, so
    // this route also serves any generation the rotation records for it. The
    // store checks approval and the serving-key shape itself.
    extraServingKey: (profileId, generation) =>
      profileCoverPhotoStore().approvedObjectKey(profileId, generation),
    ...coverTestDeps,
  };
}

/**
 * A moderator may read a cover only while that generation waits in the
 * reported-cover queue: the profile's first cover with an undecided report, or
 * a rotation row the review list still holds. Asked again on every read.
 */
async function reviewQueueCoverRefusal(
  _request: Request,
  profile: ProfileRecord,
  generation: string,
): Promise<CoverReadRefusal | null> {
  if (
    isReportedImageQueueRow(profile, "cover") &&
    profileImageState(profile, "cover").generation === generation
  ) {
    return null;
  }
  try {
    const queued = await profileCoverPhotoStore().listForReview();
    return queued.some(
      (row) =>
        row.profileId === profile.id &&
        row.generation === generation &&
        row.moderationState === "approved",
    )
      ? null
      : "not_in_review_queue";
  } catch {
    return "not_in_review_queue";
  }
}

/** Cover deps for the moderator preview route. The caller checks the moderator credential. */
export function moderatorCoverPreviewRouteDeps(): ProfileImageServeDeps {
  return { ...coverServeRouteDeps(), coverReadRefusal: reviewQueueCoverRefusal };
}
