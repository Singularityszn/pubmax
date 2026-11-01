// THE LONDON LANE: what a signed-out visitor reads on /social.
//
// Captain decision 7, 1 November 2026, which closes decision D2 of the
// 30 October launch review: a stranger may READ public London posts. Posting,
// cheers, comments, saves, follows and messages still need an account.
//
// This leaf is pure and imports no store, so the page's client bundle can read
// the words and the wire shape with no server module behind them. Each rule
// has one owner elsewhere:
//
//   - WHICH posts are in the lane: `keepLondonLane` in lib/socialPostStore.ts,
//     for both backends and for the photo door.
//   - WHETHER the lane is open: `socialLondonLaneOpen` in
//     lib/socialLondonLane.server.ts, over the launch switch and the freeze.
//   - WHICH photo tags ride a post: the consent store, read for nobody.
//
// What lives here is the area half of "London", the wire shape, the allow-list
// projection onto it and every sentence the lane prints.

import { LONDON_NIGHT_AREA_SLUGS } from "@/lib/nightAreaSlugs";
import type { SocialPostDTO } from "@/lib/socialPosts";

/** The `lane` value `GET /api/social/posts` reads for the signed-out lane. */
export const SOCIAL_LONDON_LANE = "london";

/** How many posts one page of the lane asks for. */
const SOCIAL_LONDON_LANE_PAGE = 20;

const LONDON_AREAS = new Set<string>(LONDON_NIGHT_AREA_SLUGS);

/**
 * A post belongs to London when its author tagged it with one of London's
 * patches. A post with no area is not provably London, so it stays out: the
 * exact pub that could place it is withheld from anybody who is not a mutual.
 */
export function isLondonLaneArea(area: string | null | undefined): boolean {
  return typeof area === "string" && LONDON_AREAS.has(area);
}

/**
 * ONE POST AS A STRANGER READS IT. An ALLOW LIST, the `lib/profileVisibility.ts`
 * idiom: a field added to `SocialPostDTO` tomorrow is withheld here by default,
 * because a deny list is how the next field leaks.
 *
 * Withheld on purpose: `ownedByViewer` and every other word about the reader;
 * `revision` and `mutationVersion`, which only an editor needs; the pub, its
 * name and the author's score, which only a mutual reads; the face, because
 * whether a public card wears a face is still the captain's open question
 * (launch review, decision 5); and photos 2 to 4 and a reel, which are served
 * only to a signed-in reader.
 */
export type SocialLondonLanePost = {
  id: string;
  kind: SocialPostDTO["kind"];
  visibility: "public";
  body: string;
  area: SocialPostDTO["area"];
  hashtags: string[];
  photo: { mediaId: string; altText: string; tags: Array<{ handle: string }> } | null;
  nameHidden: boolean;
  /** Null on a hidden-name post: readers see "a PUBMAXXER" and nothing else. */
  author: { handle: string | null };
  createdAt: string;
  editedAt: string | null;
};

export type SocialLondonLanePage = {
  posts: SocialLondonLanePost[];
  nextCursor: string | null;
};

/**
 * Copy a post the store already let into the lane onto the stranger's shape.
 * It is not a filter: a post that is not public here means the store broke its
 * own rule, so it throws, and the route answers a 503 rather than labelling a
 * private post "Public".
 */
export function londonLanePost(post: SocialPostDTO): SocialLondonLanePost {
  if (post.visibility !== "public") {
    throw new Error("A London lane post must be public.");
  }
  return {
    id: post.id,
    kind: post.kind,
    visibility: "public",
    body: post.body,
    area: post.area,
    hashtags: [...post.hashtags],
    photo: post.photo
      ? {
          mediaId: post.photo.mediaId,
          altText: post.photo.altText,
          tags: (post.photo.tags ?? []).map((tag) => ({ handle: tag.handle })),
        }
      : null,
    nameHidden: post.nameHidden,
    author: { handle: post.author.handle },
    createdAt: post.createdAt,
    editedAt: post.editedAt,
  };
}

/** Where the page asks for one page of the lane. */
export function socialLondonLaneHref(cursor?: string | null): string {
  const params = new URLSearchParams({
    lane: SOCIAL_LONDON_LANE,
    limit: String(SOCIAL_LONDON_LANE_PAGE),
  });
  if (cursor) params.set("cursor", cursor);
  return `/api/social/posts?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseTags(value: unknown): Array<{ handle: string }> | null {
  if (!Array.isArray(value)) return null;
  const tags: Array<{ handle: string }> = [];
  for (const tag of value) {
    if (!isRecord(tag) || typeof tag.handle !== "string") return null;
    tags.push({ handle: tag.handle });
  }
  return tags;
}

function parsePhoto(value: unknown): SocialLondonLanePost["photo"] | undefined {
  if (value === null) return null;
  if (!isRecord(value) || typeof value.mediaId !== "string" || typeof value.altText !== "string") return undefined;
  const tags = parseTags(value.tags);
  return tags ? { mediaId: value.mediaId, altText: value.altText, tags } : undefined;
}

function parsePost(value: unknown): SocialLondonLanePost | null {
  if (!isRecord(value) || !isRecord(value.author)) return null;
  const photo = parsePhoto(value.photo);
  if (
    typeof value.id !== "string" ||
    (value.kind !== "standard" && value.kind !== "feature_request") ||
    value.visibility !== "public" ||
    typeof value.body !== "string" ||
    !isLondonLaneArea(typeof value.area === "string" ? value.area : null) ||
    !Array.isArray(value.hashtags) || value.hashtags.some((tag) => typeof tag !== "string") ||
    photo === undefined ||
    typeof value.nameHidden !== "boolean" ||
    (value.author.handle !== null && typeof value.author.handle !== "string") ||
    typeof value.createdAt !== "string" ||
    (value.editedAt !== null && typeof value.editedAt !== "string")
  ) return null;
  return {
    id: value.id,
    kind: value.kind,
    visibility: "public",
    body: value.body,
    area: value.area as SocialLondonLanePost["area"],
    hashtags: value.hashtags as string[],
    photo,
    nameHidden: value.nameHidden,
    author: { handle: value.author.handle as string | null },
    createdAt: value.createdAt,
    editedAt: value.editedAt as string | null,
  };
}

/**
 * Read one page off the wire, keeping only the allow-listed fields. A page that
 * does not parse is refused whole, the way the signed-in feed refuses one.
 */
export function parseSocialLondonLanePage(value: unknown): SocialLondonLanePage | null {
  if (!isRecord(value) || !Array.isArray(value.posts)) return null;
  const posts: SocialLondonLanePost[] = [];
  for (const candidate of value.posts) {
    const post = parsePost(candidate);
    if (!post) return null;
    posts.push(post);
  }
  const nextCursor = value.nextCursor;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { posts, nextCursor };
}

/**
 * Every sentence the lane prints, written down once (docs/VOICE.md). The
 * sign-in line sits where a signed-in reader's cheer and comment row sits, and
 * it is quiet: the one filled action on the page stays the Screen's door.
 */
export const SOCIAL_LONDON_LANE_COPY = {
  title: "Across London",
  line: "Public posts tagged a London patch. Newest first.",
  signIn: "Sign in to cheer or comment",
  emptyTitle: "No London posts yet.",
  emptyLine: "When somebody posts a public night in a London patch, it lands here.",
  unavailable: "London posts are unavailable right now.",
  retry: "Retry",
  more: "Load more",
  loadingMore: "Loading…",
  /** The API refusal while Social is rolled back or frozen. */
  paused: "Public posts are paused for a bit. The map and prices are open.",
} as const;
