export { normalizeSocialHashtag } from "@/lib/socialHashtag";
import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";
import { dropWithdrawnAuthors } from "@/lib/accountPublicAccess.server";
import { resolveAvatarUrlsForHandles } from "@/lib/avatarResolve";
import { normalizeHandle } from "@/lib/profiles";
import { hiddenNamePostRefusal } from "@/lib/socialHiddenName";
import { normalizeSocialHashtag } from "@/lib/socialHashtag";
import type { SocialPostReview } from "@/lib/socialPostReviews";
import type { SocialPostVideo } from "@/lib/socialPostVideos";
import type { SocialPostExtraPhoto } from "@/lib/socialPostPhotos";

const SOCIAL_POST_KINDS = ["standard", "feature_request"] as const;
const SOCIAL_POST_VISIBILITIES = ["public", "friends", "private"] as const;
const SOCIAL_POST_COMMENT_POLICIES = ["open", "friends", "locked"] as const;

type SocialPostKind = (typeof SOCIAL_POST_KINDS)[number];
export type SocialPostVisibility = (typeof SOCIAL_POST_VISIBILITIES)[number];
type SocialPostStatus = "visible" | "hidden" | "removed";
export type SocialPostCommentPolicy = (typeof SOCIAL_POST_COMMENT_POLICIES)[number];
type SocialPostModerationState = "pending" | "approved" | "needs_review";

export type SocialPostPhoto = {
  mediaId: string;
  altText: string;
  tags?: Array<{ handle: string }>;
};

export type SocialPostFields = {
  kind: SocialPostKind;
  visibility: SocialPostVisibility;
  body: string;
  area: NightAreaSlug | null;
  venueId: string | null;
  hashtags: string[];
  commentPolicy: SocialPostCommentPolicy;
  photo: SocialPostPhoto | null;
  /**
   * The author chose, when posting, that readers see "a PUBMAXXER" instead of
   * their handle. Set once at creation and never edited. PUBMAXX still knows
   * the author: moderation, reports, blocks and the author's own reads all
   * keep the real account. A hidden-name post is public and names no exact pub
   * (`hiddenNamePostRefusal` in `lib/socialHiddenName.ts`).
   */
  nameHidden: boolean;
};

type SocialPostFeatureRequest = {
  status: "submitted" | "planned" | "shipped" | "declined";
  staffResponse: string | null;
};

export type SocialPost = SocialPostFields & {
  id: string;
  authorProfileId: string;
  authorHandle: string;
  status: SocialPostStatus;
  moderationState: SocialPostModerationState;
  featureRequest: SocialPostFeatureRequest | null;
  revision: number;
  mutationVersion: number;
  editedAt: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialPostDTO = Omit<
  SocialPost,
  "authorProfileId" | "authorHandle" | "status" | "moderatedAt"
> & {
  /**
   * The author as this viewer may see them. `handle` is null on a hidden-name
   * post read by anybody but its author, and nothing else about the author
   * (avatar, profile link) is sent in its place.
   */
  author: { handle: string | null; avatarUrl?: string };
  ownedByViewer: boolean;
  venueName: string | null;
  venueProjected: boolean;
  /** The author's own score for the pub, shown only beside a projected venue. */
  review?: SocialPostReview | null;
  /** One video, held for review: its author sees it at once, others once approved. */
  video?: SocialPostVideo | null;
  /** Photos 2 to 4, each screened on its own (0185). */
  extraPhotos?: SocialPostExtraPhoto[];
};

type ValidationErrorCode =
  | "INVALID_POST"
  | "INVALID_AREA"
  | "FEATURE_REQUEST_BODY_REQUIRED";

export type SocialPostValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ValidationErrorCode; error: string };

export type SocialPostEditValidationResult =
  | {
      ok: true;
      value: Partial<SocialPostFields>;
      expectedMutationVersion: number;
      moderationSensitive: boolean;
    }
  | { ok: false; code: ValidationErrorCode; error: string };

const CREATE_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags",
  "commentPolicy", "nameHidden",
]);
const EDIT_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags",
  "commentPolicy", "expectedMutationVersion",
]);
const MODERATION_SENSITIVE_KEYS = new Set(["kind", "body", "hashtags"]);
const AREA_SET = new Set<string>(NIGHT_AREA_SLUGS);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, cap: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, cap);
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? value as T
    : null;
}

function parseArea(value: unknown): NightAreaSlug | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const area = value.trim().toLowerCase();
  return AREA_SET.has(area) ? area as NightAreaSlug : undefined;
}

function parseHashtags(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const tag = normalizeSocialHashtag(raw);
    if (!tag) return null;
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function invalid(error: string, code: ValidationErrorCode = "INVALID_POST") {
  return { ok: false as const, code, error };
}

export function isSocialPostArea(value: string | null | undefined): value is NightAreaSlug {
  return typeof value === "string" && AREA_SET.has(value);
}

export function validateSocialPostCreate(
  input: unknown,
  options: { trustedPhoto?: SocialPostPhoto | null } = {},
): SocialPostValidationResult<SocialPostFields> {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !CREATE_KEYS.has(key))) {
    return invalid("Post details are not valid.");
  }
  const kind = oneOf(raw.kind, SOCIAL_POST_KINDS);
  const visibility = oneOf(raw.visibility, SOCIAL_POST_VISIBILITIES);
  const commentPolicy = oneOf(raw.commentPolicy, SOCIAL_POST_COMMENT_POLICIES);
  if (!kind || !visibility || !commentPolicy) return invalid("Post details are not valid.");
  if (raw.nameHidden !== undefined && typeof raw.nameHidden !== "boolean") {
    return invalid("Post details are not valid.");
  }
  const nameHidden = raw.nameHidden === true;

  const body = cleanText(raw.body, 2_000);
  const area = parseArea(raw.area);
  if (area === undefined) return invalid("Choose a listed area.", "INVALID_AREA");
  const venueId = raw.venueId == null ? null : cleanText(raw.venueId, 100);
  if (raw.venueId != null && !venueId) return invalid("Choose a valid venue.");
  const hashtags = parseHashtags(raw.hashtags);
  if (!hashtags) return invalid("Post details are not valid.");
  const photo = options.trustedPhoto ?? null;
  if (kind === "feature_request" && !body) {
    return invalid("Add words to a feature request.", "FEATURE_REQUEST_BODY_REQUIRED");
  }
  if (!body && !photo) return invalid("Add some words or a photo.");
  const hiddenNameRefusal = hiddenNamePostRefusal({ nameHidden, visibility, venueId });
  if (hiddenNameRefusal) return invalid(hiddenNameRefusal);
  return {
    ok: true,
    value: { kind, visibility, body, area, venueId, hashtags, commentPolicy, photo, nameHidden },
  };
}

export function validateSocialPostEdit(input: unknown): SocialPostEditValidationResult {
  const raw = record(input);
  if (!raw || Object.keys(raw).length === 0 || Object.keys(raw).some((key) => !EDIT_KEYS.has(key))) {
    return invalid("Post changes are not valid.");
  }
  const expectedMutationVersion = raw.expectedMutationVersion;
  if (!Number.isInteger(expectedMutationVersion) || Number(expectedMutationVersion) < 0) {
    return invalid("Post changes are not valid.");
  }
  const value: Partial<SocialPostFields> = {};
  if ("kind" in raw) {
    const kind = oneOf(raw.kind, SOCIAL_POST_KINDS);
    if (!kind) return invalid("Post changes are not valid.");
    value.kind = kind;
  }
  if ("visibility" in raw) {
    const visibility = oneOf(raw.visibility, SOCIAL_POST_VISIBILITIES);
    if (!visibility) return invalid("Post changes are not valid.");
    value.visibility = visibility;
  }
  if ("commentPolicy" in raw) {
    const policy = oneOf(raw.commentPolicy, SOCIAL_POST_COMMENT_POLICIES);
    if (!policy) return invalid("Post changes are not valid.");
    value.commentPolicy = policy;
  }
  if ("body" in raw) value.body = cleanText(raw.body, 2_000);
  if ("area" in raw) {
    const area = parseArea(raw.area);
    if (area === undefined) return invalid("Choose a listed area.", "INVALID_AREA");
    value.area = area;
  }
  if ("venueId" in raw) {
    const venueId = raw.venueId == null ? null : cleanText(raw.venueId, 100);
    if (raw.venueId != null && !venueId) return invalid("Choose a valid venue.");
    value.venueId = venueId;
  }
  if ("hashtags" in raw) {
    const hashtags = parseHashtags(raw.hashtags);
    if (!hashtags) return invalid("Post changes are not valid.");
    value.hashtags = hashtags;
  }
  if (Object.keys(value).length === 0) return invalid("Post changes are not valid.");
  return {
    ok: true,
    value,
    expectedMutationVersion: Number(expectedMutationVersion),
    moderationSensitive: Object.keys(value).some((key) => MODERATION_SENSITIVE_KEYS.has(key)),
  };
}

export function socialPostDTO(
  post: SocialPost,
  projection: {
    exactVenue: boolean;
    viewerProfileId?: string | null;
    venueName?: string | null;
  } = { exactVenue: false },
): SocialPostDTO {
  const exactVenue = Boolean(post.venueId && projection.exactVenue);
  const ownedByViewer = post.authorProfileId === projection.viewerProfileId;
  return {
    id: post.id,
    kind: post.kind,
    visibility: post.visibility,
    body: post.body,
    area: post.area,
    venueId: exactVenue ? post.venueId : null,
    venueName: exactVenue ? projection.venueName ?? null : null,
    venueProjected: exactVenue,
    hashtags: [...post.hashtags],
    commentPolicy: post.commentPolicy,
    photo: post.photo
      ? { ...post.photo, ...(post.photo.tags ? { tags: post.photo.tags.map((tag) => ({ ...tag })) } : {}) }
      : null,
    moderationState: post.moderationState,
    featureRequest: post.featureRequest ? { ...post.featureRequest } : null,
    revision: post.revision,
    mutationVersion: post.mutationVersion,
    editedAt: post.editedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    nameHidden: post.nameHidden,
    // The ONE place a hidden name is taken off. Every read of a post a viewer
    // receives is built here, so no route has to remember to do it.
    author: { handle: post.nameHidden && !ownedByViewer ? null : post.authorHandle },
    ownedByViewer,
  };
}

export function socialPostModerationClaim(
  post: Pick<SocialPostFields, "body" | "hashtags" | "photo">,
): string {
  const sections = [post.body];
  if (post.hashtags.length > 0) sections.push(post.hashtags.map((tag) => `#${tag}`).join(" "));
  if (post.photo) sections.push(`Photo: ${post.photo.altText}`);
  return sections.filter(Boolean).join("\n\n");
}

/**
 * Drop posts by a withdrawn author and add avatars. A hidden-name post that
 * reaches here with no handle was already checked for a withdrawn author by
 * the store, which still knows the account (`dropWithdrawnHiddenNamePosts`),
 * and it gets no avatar, because a face is a name.
 *
 * `faces: false` drops the withdrawn authors and adds no avatar at all: the
 * signed-out London lane prints handles only, because whether a public card
 * wears a face is still the captain's open question.
 */
export async function enrichSocialPostAuthors(
  posts: readonly SocialPostDTO[],
  options: { faces?: boolean } = {},
): Promise<SocialPostDTO[]> {
  const visible = await dropWithdrawnAuthors(posts, (post) => post.author.handle);
  if (visible.length === 0) return [];
  if (options.faces === false) return visible;
  const named = visible.flatMap((post) => post.author.handle ? [post.author.handle] : []);
  const urls = named.length > 0 ? await resolveAvatarUrlsForHandles(named) : new Map<string, string>();
  return visible.map((post) => {
    if (!post.author.handle) return post;
    const avatarUrl = urls.get(normalizeHandle(post.author.handle));
    return avatarUrl
      ? { ...post, author: { ...post.author, avatarUrl } }
      : post;
  });
}
