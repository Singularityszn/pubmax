/**
 * ONE HASHTAG RULE, read by the composer's validation, the Across-town tag
 * filter and the tag links on a post card. Pure leaf: it imports nothing, so
 * the browser and the server compare a tag the same way.
 *
 * A stored tag is trimmed, lower case, has no leading "#", and is letters,
 * digits or underscores up to 40.
 */
const SOCIAL_HASHTAG = /^[a-z0-9_]{1,40}$/;

/** The tag the way the composer stores it, or null when it is not one. */
export function normalizeSocialHashtag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().toLowerCase().replace(/^#/, "");
  return SOCIAL_HASHTAG.test(tag) ? tag : null;
}
