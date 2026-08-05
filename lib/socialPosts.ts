import { NIGHT_AREA_SLUGS, type NightAreaSlug } from "@/lib/nightAreas";

export const SOCIAL_POST_KINDS = ["standard", "feature_request"] as const;
export const SOCIAL_POST_VISIBILITIES = ["public", "friends", "private"] as const;
export const SOCIAL_POST_STATUSES = ["visible", "hidden", "removed"] as const;
export const SOCIAL_POST_COMMENT_POLICIES = ["open", "friends", "locked"] as const;

export type SocialPostKind = (typeof SOCIAL_POST_KINDS)[number];
export type SocialPostVisibility = (typeof SOCIAL_POST_VISIBILITIES)[number];
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];
export type SocialPostCommentPolicy = (typeof SOCIAL_POST_COMMENT_POLICIES)[number];
export type SocialPostModerationState = "pending" | "approved" | "needs_review";

export type SocialPostPhoto = {
  mediaId: string;
  altText: string;
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
};

export type SocialPostFeatureRequest = {
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
  editedAt: string | null;
  moderatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SocialPostDTO = Omit<
  SocialPost,
  "authorProfileId" | "authorHandle" | "status" | "moderatedAt"
> & {
  author: { handle: string };
};

type ValidationErrorCode =
  | "INVALID_POST"
  | "INVALID_AREA"
  | "EXACT_VENUE_NOT_ALLOWED"
  | "FEATURE_REQUEST_BODY_REQUIRED";

export type SocialPostValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ValidationErrorCode; error: string };

export type SocialPostEditValidationResult =
  | { ok: true; value: Partial<SocialPostFields>; contentChanged: boolean }
  | { ok: false; code: ValidationErrorCode; error: string };

const CREATE_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags",
  "commentPolicy", "photo",
]);
const EDIT_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags",
  "commentPolicy", "photo",
]);
const CONTENT_KEYS = new Set(["kind", "body", "hashtags", "photo"]);
const AREA_SET = new Set<string>(NIGHT_AREA_SLUGS);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASHTAG = /^[a-z0-9_]{1,40}$/;

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
    if (typeof raw !== "string") return null;
    const tag = raw.trim().toLowerCase().replace(/^#/, "");
    if (!HASHTAG.test(tag)) return null;
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function parsePhoto(value: unknown): SocialPostPhoto | null | undefined {
  if (value === undefined || value === null) return null;
  const photo = record(value);
  if (!photo || Object.keys(photo).some((key) => !["mediaId", "altText"].includes(key))) {
    return undefined;
  }
  const mediaId = typeof photo.mediaId === "string" ? photo.mediaId.trim() : "";
  const altText = cleanText(photo.altText, 300);
  return UUID.test(mediaId) && altText ? { mediaId, altText } : undefined;
}

function invalid(error: string, code: ValidationErrorCode = "INVALID_POST") {
  return { ok: false as const, code, error };
}

export function isSocialPostArea(value: string | null | undefined): value is NightAreaSlug {
  return typeof value === "string" && AREA_SET.has(value);
}

export function validateSocialPostCreate(
  input: unknown,
): SocialPostValidationResult<SocialPostFields> {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !CREATE_KEYS.has(key))) {
    return invalid("Post details are not valid.");
  }
  const kind = oneOf(raw.kind, SOCIAL_POST_KINDS);
  const visibility = oneOf(raw.visibility, SOCIAL_POST_VISIBILITIES);
  const commentPolicy = oneOf(raw.commentPolicy, SOCIAL_POST_COMMENT_POLICIES);
  if (!kind || !visibility || !commentPolicy) return invalid("Post details are not valid.");

  const body = cleanText(raw.body, 2_000);
  const area = parseArea(raw.area);
  if (area === undefined) return invalid("Choose a listed area.", "INVALID_AREA");
  const venueId = raw.venueId == null ? null : cleanText(raw.venueId, 100);
  if (raw.venueId != null && !venueId) return invalid("Choose a valid venue.");
  if (visibility === "public" && venueId) {
    return invalid("Exact venue posts are for friends or private posts.", "EXACT_VENUE_NOT_ALLOWED");
  }
  const hashtags = parseHashtags(raw.hashtags);
  const photo = parsePhoto(raw.photo);
  if (!hashtags || photo === undefined) return invalid("Post details are not valid.");
  if (!body && !photo) return invalid("Add some words or a photo.");
  if (kind === "feature_request" && !body) {
    return invalid("Add words to a feature request.", "FEATURE_REQUEST_BODY_REQUIRED");
  }
  return {
    ok: true,
    value: { kind, visibility, body, area, venueId, hashtags, commentPolicy, photo },
  };
}

export function validateSocialPostEdit(input: unknown): SocialPostEditValidationResult {
  const raw = record(input);
  if (!raw || Object.keys(raw).length === 0 || Object.keys(raw).some((key) => !EDIT_KEYS.has(key))) {
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
  if ("photo" in raw) {
    const photo = parsePhoto(raw.photo);
    if (photo === undefined) return invalid("Post changes are not valid.");
    value.photo = photo;
  }
  return {
    ok: true,
    value,
    contentChanged: Object.keys(value).some((key) => CONTENT_KEYS.has(key)),
  };
}

export function socialPostDTO(post: SocialPost): SocialPostDTO {
  return {
    id: post.id,
    kind: post.kind,
    visibility: post.visibility,
    body: post.body,
    area: post.area,
    venueId: post.venueId,
    hashtags: [...post.hashtags],
    commentPolicy: post.commentPolicy,
    photo: post.photo ? { ...post.photo } : null,
    moderationState: post.moderationState,
    featureRequest: post.featureRequest ? { ...post.featureRequest } : null,
    revision: post.revision,
    editedAt: post.editedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    author: { handle: post.authorHandle },
  };
}
