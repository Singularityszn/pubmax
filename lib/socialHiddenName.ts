// Hidden-name Social posts: the one shape rule and every word a person reads.
//
// A pure leaf with no server import, so the composer, the post card and the
// store all read the same rule and the same words. The rule is mirrored by the
// table CHECK in migration 0191; the reading rule (who sees the handle) is
// `socialPostDTO` in `lib/socialPosts.ts`.
//
// WHAT HIDING THE NAME MEANS. Readers see "a PUBMAXXER" instead of the handle,
// with no avatar and no profile link. PUBMAXX still knows the author: the
// post is moderated before anybody reads it, a report reaches the real
// account, a block still works, and a moderator sees the handle. It is a
// choice made once, when posting; an edit can neither hide nor reveal it.

import { ANON_HANDLE_LABEL } from "@/lib/pintDropShared";

/** What a reader sees where a hidden-name post's handle would be. */
export const HIDDEN_NAME_AUTHOR_LABEL = ANON_HANDLE_LABEL;

export const HIDDEN_NAME_PUBLIC_ONLY_MESSAGE =
  "A post with your name hidden is public. Choose Public to post it.";
export const HIDDEN_NAME_NO_PUB_MESSAGE =
  "A post with your name hidden cannot name a pub. Remove the pub, or show your name.";
export const HIDDEN_NAME_NO_TAGS_MESSAGE =
  "A post with your name hidden cannot tag people, because a tag shows them your name.";

/** The composer's switch and the line under it. */
export const HIDDEN_NAME_TOGGLE_LABEL = "Hide my name on this post";
export const HIDDEN_NAME_TOGGLE_HINT =
  "People see “a PUBMAXXER”, not your handle. The post is public, names no pub and tags nobody. We still know it's you, and the house rules still apply.";

/** Under the author line of a hidden-name post. */
export const HIDDEN_NAME_OWN_LINE = "Your name is hidden on this post";
export const HIDDEN_NAME_READER_LINE = "Name hidden";

/** "Why this post?" for a reader: there is no profile to mute from. */
export const HIDDEN_NAME_CONTROL_LINE =
  "The name is hidden, so there's no profile to mute. Report it if it breaks the house rules.";

/**
 * The one shape rule for a hidden-name post, shared by create, edit and the
 * composer. A friends-only post tells a reader the author is one of their
 * mutuals, and an exact pub sits beside the author's own pub score, so either
 * one would name the author by inference.
 */
export function hiddenNamePostRefusal(post: {
  nameHidden: boolean;
  visibility: string;
  venueId: string | null;
}): string | null {
  if (!post.nameHidden) return null;
  if (post.visibility !== "public") return HIDDEN_NAME_PUBLIC_ONLY_MESSAGE;
  if (post.venueId) return HIDDEN_NAME_NO_PUB_MESSAGE;
  return null;
}
