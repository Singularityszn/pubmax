// One video on a Social post: the rules a browser and the server share.
//
// A video is uploaded straight to Storage, checked by its leading bytes, and
// held until a moderator has watched it (migration 0182). Its author sees it
// at once; everybody else sees it once it is approved.

export const SOCIAL_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export type SocialVideoType = (typeof SOCIAL_VIDEO_TYPES)[number];

/** 100 MB: about three minutes of phone video at a sensible bitrate. */
export const SOCIAL_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
/** Ten minutes, the long end of a reel. */
export const SOCIAL_VIDEO_MAX_SECONDS = 600;

export type SocialVideoReviewState = "held" | "approved" | "rejected";

export type SocialPostVideo = {
  /** Same-origin playback door; it checks the reader on every request. */
  url: string;
  contentType: SocialVideoType;
  durationSeconds: number | null;
  /** The author sees held and rejected; everybody else only approved. */
  reviewState: SocialVideoReviewState;
};

export function isSocialVideoType(value: unknown): value is SocialVideoType {
  return typeof value === "string" && (SOCIAL_VIDEO_TYPES as readonly string[]).includes(value);
}

export function socialVideoPlaybackPath(postId: string): string {
  return `/api/social/videos/${postId}`;
}

/** A duration the server may store, or null when none was given or it is out of range. */
export function parseSocialVideoDuration(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > SOCIAL_VIDEO_MAX_SECONDS) return null;
  return Math.round(value * 100) / 100;
}

/**
 * The container the leading bytes actually hold. MP4 and QuickTime both open
 * with an `ftyp` box; QuickTime's brand is `qt  `. WebM opens with the EBML
 * magic. Anything else is not a video this product plays.
 */
export function sniffSocialVideoType(head: Uint8Array): SocialVideoType | null {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return "video/webm";
  }
  if (head.length >= 12 && String.fromCharCode(...head.subarray(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

/** "0:42", "3:05". */
export function formatSocialVideoDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
