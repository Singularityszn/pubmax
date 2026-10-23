import "server-only";

/**
 * The recap video on `/recap/[storyId]` is off unless `PUBMAX_RECAP_VIDEO=1`.
 * Remove once the video has run on production recaps and the MP4 export path
 * is chosen (`docs/plans/RECAP_VIDEO_EXPORT.md`). Off behaviour: the recap page
 * renders exactly as it did before the video existed.
 */
export function recapVideoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PUBMAX_RECAP_VIDEO?.trim() === "1";
}
