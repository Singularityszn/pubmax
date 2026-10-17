// Photos on a Social post beyond the first (migration 0185): the shapes the
// browser and the server share.
//
// The first photo keeps every rule it always had (social_posts.photo_media_id).
// Photos 2 to 4 are screened one by one: the author sees each at once, a
// reader once it is approved.

export const SOCIAL_POST_MAX_PHOTOS = 4;
export const SOCIAL_POST_EXTRA_SLOTS = [2, 3, 4] as const;
export type SocialPostExtraSlot = (typeof SOCIAL_POST_EXTRA_SLOTS)[number];

export type SocialPostExtraPhoto = {
  mediaId: string;
  slot: SocialPostExtraSlot;
  altText: string;
  /** Same-origin delivery door; it checks the reader on every request. */
  url: string;
  moderationState: "pending" | "approved" | "needs_review";
};

export function isSocialPostExtraSlot(value: unknown): value is SocialPostExtraSlot {
  return typeof value === "number" && (SOCIAL_POST_EXTRA_SLOTS as readonly number[]).includes(value);
}

export function socialExtraPhotoPath(mediaId: string): string {
  return `/api/social/photos/${mediaId}`;
}
