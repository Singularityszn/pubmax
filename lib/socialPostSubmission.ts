import { normalizeHandle } from "@/lib/profiles";
import {
  validateSocialPostCreate,
  validateSocialPostEdit,
  type SocialPostFields,
} from "@/lib/socialPosts";
import { parseSocialReviewRating } from "@/lib/socialPostReviews";
import { parseSocialVideoDuration } from "@/lib/socialPostVideos";

type SubmissionErrorCode =
  | "INVALID_POST"
  | "INVALID_AREA"
  | "FEATURE_REQUEST_BODY_REQUIRED"
  | "PHOTO_ALT_REQUIRED"
  | "INVALID_TAGS"
  | "INVALID_REVIEW"
  | "INVALID_VIDEO";

type SubmissionError = { ok: false; code: SubmissionErrorCode; error: string };

export type SocialCreateSubmission =
  | {
      ok: true;
      post: Omit<SocialPostFields, "photo">;
      photoAltText: string | null;
      tagHandles: string[];
      /** The author's own score for the pub the post names, or null. */
      reviewRating: number | null;
      /** An upload intent the author holds, to bind to the new post. */
      video: { uploadId: string; durationSeconds: number | null } | null;
    }
  | SubmissionError;

export type SocialEditSubmission =
  | {
      ok: true;
      expectedMutationVersion: number;
      changes: Partial<SocialPostFields>;
      moderationSensitive: boolean;
      removePhoto: boolean;
      photoAltText: string | null;
      tagHandles: string[];
    }
  | SubmissionError;

const CREATE_EXTRA_KEYS = new Set(["photoAltText", "tagHandles", "reviewRating", "videoUploadId", "videoDurationSeconds"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDIT_EXTRA_KEYS = new Set(["photoAltText", "tagHandles", "removePhoto"]);
const CREATE_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags", "commentPolicy",
]);
const EDIT_KEYS = new Set([
  "expectedMutationVersion", "kind", "visibility", "body", "area", "venueId", "hashtags", "commentPolicy",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanAlt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return text || null;
}

function tags(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const prepared = candidate.trim().toLowerCase().replace(/^@+/, "");
    const handle = normalizeHandle(candidate);
    if (!handle || handle !== prepared) return null;
    if (!seen.has(handle)) {
      seen.add(handle);
      result.push(handle);
    }
  }
  return result;
}

function base(
  raw: Record<string, unknown>,
  allowed: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => allowed.has(key)));
}

export function parseSocialCreateSubmission(
  input: unknown,
  hasPhoto: boolean,
): SocialCreateSubmission {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !CREATE_KEYS.has(key) && !CREATE_EXTRA_KEYS.has(key))) {
    return { ok: false, code: "INVALID_POST", error: "Post details are not valid." };
  }
  const tagHandles = tags(raw.tagHandles);
  if (!tagHandles || (!hasPhoto && tagHandles.length > 0)) {
    return { ok: false, code: "INVALID_TAGS", error: "Photo tags need an attached photo." };
  }
  const photoAltText = cleanAlt(raw.photoAltText);
  if (hasPhoto && !photoAltText) {
    return { ok: false, code: "PHOTO_ALT_REQUIRED", error: "Add photo alt text." };
  }
  if (!hasPhoto && raw.photoAltText !== undefined) {
    return { ok: false, code: "INVALID_POST", error: "Post details are not valid." };
  }
  if (raw.videoUploadId !== undefined && raw.videoUploadId !== null && !hasPhoto && !cleanAlt(raw.body)) {
    return { ok: false, code: "INVALID_VIDEO", error: "Add a caption to your video." };
  }
  const validation = validateSocialPostCreate(base(raw, CREATE_KEYS), hasPhoto
    ? {
        trustedPhoto: {
          mediaId: "00000000-0000-4000-8000-000000000000",
          altText: photoAltText!,
        },
      }
    : {});
  if (!validation.ok) return validation;
  const post = {
    kind: validation.value.kind,
    visibility: validation.value.visibility,
    body: validation.value.body,
    area: validation.value.area,
    venueId: validation.value.venueId,
    hashtags: validation.value.hashtags,
    commentPolicy: validation.value.commentPolicy,
  };
  let reviewRating: number | null = null;
  if (raw.reviewRating !== undefined && raw.reviewRating !== null) {
    reviewRating = parseSocialReviewRating(raw.reviewRating);
    if (reviewRating === null) {
      return { ok: false, code: "INVALID_REVIEW", error: "Score the pub from 1 to 5, in half stars." };
    }
    if (!post.venueId || post.kind !== "standard") {
      return { ok: false, code: "INVALID_REVIEW", error: "Pick the pub you are scoring." };
    }
  }
  let video: { uploadId: string; durationSeconds: number | null } | null = null;
  if (raw.videoUploadId !== undefined && raw.videoUploadId !== null) {
    if (typeof raw.videoUploadId !== "string" || !UUID.test(raw.videoUploadId) || hasPhoto) {
      return { ok: false, code: "INVALID_VIDEO", error: "A post carries one photo or one video." };
    }
    if (!post.body) {
      return { ok: false, code: "INVALID_VIDEO", error: "Add a caption to your video." };
    }
    video = { uploadId: raw.videoUploadId, durationSeconds: parseSocialVideoDuration(raw.videoDurationSeconds) };
  } else if (raw.videoDurationSeconds !== undefined) {
    return { ok: false, code: "INVALID_POST", error: "Post details are not valid." };
  }
  return { ok: true, post, photoAltText, tagHandles, reviewRating, video };
}

export function parseSocialEditSubmission(
  input: unknown,
  hasPhoto: boolean,
): SocialEditSubmission {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !EDIT_KEYS.has(key) && !EDIT_EXTRA_KEYS.has(key))) {
    return { ok: false, code: "INVALID_POST", error: "Post changes are not valid." };
  }
  const removePhoto = raw.removePhoto === true;
  if ((raw.removePhoto !== undefined && typeof raw.removePhoto !== "boolean") || (removePhoto && hasPhoto)) {
    return { ok: false, code: "INVALID_POST", error: "Post changes are not valid." };
  }
  const tagHandles = tags(raw.tagHandles);
  if (!tagHandles || (!hasPhoto && tagHandles.length > 0)) {
    return { ok: false, code: "INVALID_TAGS", error: "Photo tags need an attached photo." };
  }
  const photoAltText = cleanAlt(raw.photoAltText);
  if (hasPhoto && !photoAltText) {
    return { ok: false, code: "PHOTO_ALT_REQUIRED", error: "Add photo alt text." };
  }
  if (!hasPhoto && raw.photoAltText !== undefined && (!photoAltText || removePhoto)) {
    return { ok: false, code: photoAltText ? "INVALID_POST" : "PHOTO_ALT_REQUIRED", error: photoAltText ? "Post changes are not valid." : "Add photo alt text." };
  }
  const baseInput = base(raw, EDIT_KEYS);
  const validation = validateSocialPostEdit(baseInput);
  const altOnly = !hasPhoto && Boolean(photoAltText) && Object.keys(baseInput).every((key) => key === "expectedMutationVersion") &&
    Number.isInteger(raw.expectedMutationVersion) && Number(raw.expectedMutationVersion) >= 0;
  if (!validation.ok && !altOnly) return validation;
  return {
    ok: true,
    expectedMutationVersion: validation.ok ? validation.expectedMutationVersion : Number(raw.expectedMutationVersion),
    changes: validation.ok ? validation.value : {},
    moderationSensitive: (validation.ok && validation.moderationSensitive) || hasPhoto || removePhoto || Boolean(photoAltText),
    removePhoto,
    photoAltText,
    tagHandles,
  };
}
