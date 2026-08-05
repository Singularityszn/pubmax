import { assertServerEnv } from "@/lib/serverEnv";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  prepareSocialPhoto,
  reconcileSocialPhotoUpload,
  reserveSocialPhotoUpload,
  SOCIAL_PHOTO_MAX_BYTES,
  SocialPhotoError,
  uploadPreparedSocialPhoto,
  type UploadedSocialPhoto,
} from "@/lib/socialPostMedia.server";
import { socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { parseSocialCreateSubmission } from "@/lib/socialPostSubmission";
import { projectSocialVenueName, projectSocialVenueNames, resolveSocialVenueId, type SocialVenueResolution } from "@/lib/socialPostVenue.server";
import { isSocialPostArea, type SocialPostFields } from "@/lib/socialPosts";
import { hashActor } from "@/lib/supabase";
import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import { socialPhotoMediaId, socialPostRequestDigest, validSocialPostIdempotencyKey } from "@/lib/socialPostIdempotency.server";
import { readSocialPostCreateRequest } from "@/lib/socialPostCreateRequest.server";

assertServerEnv();

const FEED_RATE_LIMIT = 60;
const FEED_RATE_WINDOW_MS = 60_000;

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

async function submissionBody(request: Request): Promise<{
  input: unknown;
  photo: File | null;
} | null> {
  try {
    const contentType = request.headers.get("Content-Type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return { input: await boundedJson(request), photo: null };
    }
    const form = await boundedFormData(request, SOCIAL_PHOTO_MAX_BYTES + 64 * 1024);
    if ([...form.keys()].some((key) => key !== "post" && key !== "photo")) return null;
    const postParts = form.getAll("post");
    const photoParts = form.getAll("photo");
    if (postParts.length !== 1 || typeof postParts[0] !== "string" || photoParts.length > 1) return null;
    const photo = photoParts[0] ?? null;
    if (photo !== null && !(photo instanceof File)) return null;
    return { input: JSON.parse(postParts[0]), photo };
  } catch {
    return null;
  }
}

function accessError(access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>): Response {
  return privateJson({
    code: access.code,
    error: access.error,
    ...(access.retryable ? { retryable: true } : {}),
  }, { status: access.status });
}

function storeError(error: unknown): Response {
  if (error instanceof SocialPostStoreError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : error.code === "EDIT_CONFLICT" || error.code === "IDEMPOTENCY_CONFLICT" ? 409
          : 400;
    return privateJson({ code: error.code, error: error.message }, { status });
  }
  return privateJson(
    { code: "SOCIAL_POSTS_UNAVAILABLE", error: "Social posts are unavailable right now.", retryable: true },
    { status: 503 },
  );
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const params = new URL(request.url).searchParams;
  const lane = params.get("lane") ?? "discover";
  if (lane !== "discover" && lane !== "nearby" && lane !== "following") {
    return privateJson({ code: "INVALID_LANE", error: "Choose a Social feed." }, { status: 400 });
  }
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return privateJson({ code: "INVALID_LIMIT", error: "Feed size must be between 1 and 50." }, { status: 400 });
  }
  const area = params.get("area");
  if (lane === "nearby" && !isSocialPostArea(area)) {
    return privateJson({ code: "INVALID_AREA", error: "Choose a listed area." }, { status: 400 });
  }
  const areaScope = lane === "nearby" ? area : "all";
  const feedKey = `social-post-feed:${hashActor(access.actor.profileId)}:${lane}:${areaScope}`;
  if (await isLimited(feedKey, feedKey, FEED_RATE_LIMIT, FEED_RATE_WINDOW_MS)) {
    return privateJson(
      { code: "RATE_LIMITED", error: "Too many Social feed requests. Slow down.", retryable: true },
      { status: 429 },
    );
  }
  try {
    const page = await socialPostStore().feed(access.actor, {
      lane,
      area: area ?? undefined,
      cursor: params.get("cursor"),
      limit,
    });
    const photoPostIds = page.posts.filter((post) => post.photo).map((post) => post.id);
    const tags = photoPostIds.length > 0
      ? await socialPostConsentStore.approvedTags(access.actor, photoPostIds)
      : new Map();
    return privateJson({
      ...page,
      posts: await projectSocialVenueNames(page.posts.map((post) => post.photo
        ? { ...post, photo: { ...post.photo, tags: tags.get(post.id) ?? [] } }
        : post)),
    });
  } catch (error) {
    return storeError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!validSocialPostIdempotencyKey(idempotencyKey)) return privateJson({ code: "INVALID_IDEMPOTENCY_KEY", error: "Post request key is not valid." }, { status: 400 });
  const submitted = await submissionBody(request);
  if (submitted === null) {
    return privateJson({ code: "MALFORMED_REQUEST", error: "Post request is not valid." }, { status: 400 });
  }
  const validation = parseSocialCreateSubmission(submitted.input, submitted.photo !== null);
  if (!validation.ok) {
    return privateJson({ code: validation.code, error: validation.error }, { status: 400 });
  }
  const limitKey = `social-post-create:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey)) {
    return privateJson(
      { code: "RATE_LIMITED", error: "Too many Social posts. Slow down.", retryable: true },
      { status: 429 },
    );
  }
  let fields: SocialPostFields = { ...validation.post, photo: null };
  let resolvedVenue: Extract<SocialVenueResolution, { ok: true }> | null = null;
  if (fields.venueId) {
    const venue = await resolveSocialVenueId(fields.venueId);
    if (!venue.ok) {
      return privateJson(
        venue.unavailable
          ? { code: "VENUE_LOOKUP_UNAVAILABLE", error: "Venue search is unavailable right now.", retryable: true }
          : { code: "INVALID_VENUE", error: "Choose a pub from Venue search." },
        { status: venue.unavailable ? 503 : 400 },
      );
    }
    fields = { ...fields, venueId: venue.venueId };
    resolvedVenue = venue;
  }
  let uploaded: UploadedSocialPhoto | null = null;
  let reserved: UploadedSocialPhoto | null = null;
  let replayExistingMedia = false;
  let requestDigest = socialPostRequestDigest(fields, null, []);
  try {
    if (submitted.photo) {
      const prepared = await prepareSocialPhoto(submitted.photo);
      const mediaId = socialPhotoMediaId(access.actor.profileId, idempotencyKey, prepared.sha256);
      fields = {
        ...fields,
        photo: { mediaId, altText: validation.photoAltText! },
      };
      const digest = socialPostRequestDigest(fields, prepared.sha256, validation.tagHandles);
      requestDigest = digest;
      const prior = await readSocialPostCreateRequest(access.actor.profileId, idempotencyKey);
      if (prior && prior.digest !== digest) throw new SocialPostStoreError("IDEMPOTENCY_CONFLICT", "That post request key was already used for different content.");
      replayExistingMedia = prior !== null;
      if (!prior) {
        reserved = await reserveSocialPhotoUpload(access.actor.profileId, prepared, mediaId);
        uploaded = await uploadPreparedSocialPhoto(
          access.actor.profileId,
          prepared,
          undefined,
          reserved.mediaId,
          reserved.objectKey,
          reserved.generation,
        );
      }
    }
    const post = uploaded
      ? await socialPostStore().create(access.actor, fields, {
          media: {
            mediaId: uploaded.mediaId,
            objectKey: uploaded.objectKey,
            sha256: uploaded.sha256,
            width: uploaded.width,
            height: uploaded.height,
            byteSize: uploaded.byteSize,
          },
          tagHandles: validation.tagHandles,
          idempotencyKey,
          requestDigest,
        })
      : await socialPostStore().create(access.actor, fields, {
          idempotencyKey,
          requestDigest,
          ...(replayExistingMedia ? { replayExistingMedia: true } : {}),
        });
    return privateJson({ post: await projectSocialVenueName(post, resolvedVenue) }, { status: 201 });
  } catch (error) {
    if (reserved) {
      await reconcileSocialPhotoUpload(access.actor.profileId, reserved.mediaId, reserved.generation).catch(() => false);
    }
    if (error instanceof SocialPhotoError) {
      const unavailable = error.code === "STORAGE_UNAVAILABLE";
      return privateJson(
        { code: error.code, error: error.message, ...(unavailable ? { retryable: true } : {}) },
        { status: unavailable ? 503 : 400 },
      );
    }
    return storeError(error);
  }
}
