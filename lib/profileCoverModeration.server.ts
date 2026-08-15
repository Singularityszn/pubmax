// A cover takedown crosses TWO stores, and this module is the one place that
// knows it. `profiles.cover_*` is the back-compat mirror the admin console
// writes; `profile_cover_photos` is the five-photo rotation the serve route also
// reads. The admin lane used to write only the mirror, so a hidden cover kept
// being served out of the rotation whose own row was still `approved`.
//
// The serve route already refuses terminally on a moderation decision
// (`lib/profileImageServe.server.ts`), so the bytes stop travelling either way.
// This mirror is what stops the ROTATION from disagreeing: `listApproved` feeds
// the public carousel, so without it a hidden backdrop would still be named on
// the profile card and paint five broken frames.
//
// It is deliberately whole-profile. A moderator hiding somebody's cover is
// deciding about their backdrop, and the console names no single photograph.

import { log } from "@/lib/log";
import { profileCoverPhotoStore } from "@/lib/profileCoverPhotoStore";
import type { ProfileImageSlot } from "@/lib/profileImageSlots";
import { moderateProfileImage, profileStore } from "@/lib/profileStore";

/**
 * Apply a moderator decision to an owned image, and for the cover apply the SAME
 * decision to every photo in that profile's rotation. Returns whether the image
 * itself moved; a rotation mirror that failed is logged and never turns a
 * landed takedown into a refusal the moderator would retry.
 */
export async function moderateProfileImageAcrossStores(
  handle: string,
  slot: ProfileImageSlot,
  action: "hide" | "restore",
  note?: string,
): Promise<boolean> {
  const ok = await moderateProfileImage(handle, slot, action, note);
  if (!ok || slot !== "cover") return ok;

  try {
    const profile = await profileStore().getByHandle(handle);
    if (!profile) return ok;
    await profileCoverPhotoStore().moderateAllForProfile(
      profile.id,
      action === "hide" ? "hidden" : "approved",
      note,
    );
  } catch (error) {
    log("warn", "profile_cover.moderation_mirror_skipped", {
      handle,
      action,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return ok;
}
