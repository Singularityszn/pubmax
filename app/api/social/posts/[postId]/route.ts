import { assertServerEnv } from "@/lib/serverEnv";
import { isLimited } from "@/lib/pintDrops";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { prepareSocialPhoto, reconcileSocialPhotoUpload, reserveSocialPhotoUpload, SocialPhotoError, uploadPreparedSocialPhoto, type UploadedSocialPhoto } from "@/lib/socialPostMedia.server";
import { parseSocialEditSubmission } from "@/lib/socialPostSubmission";
import { projectSocialVenueName, resolveSocialVenueId } from "@/lib/socialPostVenue.server";
import { hashActor } from "@/lib/supabase";
import { boundedFormData, boundedJson } from "@/lib/boundedRequest.server";
import { SOCIAL_PHOTO_MAX_BYTES } from "@/lib/socialPostMedia.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";

assertServerEnv();

type Context = { params: Promise<{ postId: string }> };

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

function accessError(access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>): Response {
  return privateJson({
    code: access.code,
    error: access.error,
    ...(access.retryable ? { retryable: true } : {}),
  }, { status: access.status });
}

function storeError(error: unknown): Response {
  if (error instanceof Error && /invalid Social tags/i.test(error.message)) {
    return privateJson(
      { code: "INVALID_TAGS", error: "Photo tags are not valid." },
      { status: 400 },
    );
  }
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

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readPatchInput(request: Request): Promise<{ input: unknown; photo: File | null }> {
  if (!(request.headers.get("Content-Type") ?? "").startsWith("multipart/form-data")) {
    return { input: await boundedJson(request), photo: null };
  }
  const form = await boundedFormData(request, SOCIAL_PHOTO_MAX_BYTES + 64 * 1024);
  if ([...form.keys()].some((key) => key !== "post" && key !== "photo") || form.getAll("post").length !== 1 || form.getAll("photo").length > 1) throw new Error();
  const post = form.get("post");
  const photo = form.get("photo");
  if (typeof post !== "string" || (photo !== null && !(photo instanceof File))) throw new Error();
  return { input: JSON.parse(post), photo: photo as File | null };
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const { postId } = await context.params;
  if (!validId(postId)) return privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  try {
    const store = socialPostStore();
    const post = await store.read(postId, access.actor) ?? await store.readOwned(postId, access.actor);
    const tags = post?.photo
      ? (await socialPostConsentStore.approvedTags(access.actor, [post.id])).get(post.id) ?? []
      : [];
    return post
      ? privateJson({
          post: await projectSocialVenueName(post.photo
            ? { ...post, photo: { ...post.photo, tags } }
            : post),
        })
      : privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  } catch (error) {
    return storeError(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return accessError(access);
  const { postId } = await context.params;
  if (!validId(postId)) return privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
  let input: unknown;
  let photo: File | null = null;
  try {
    ({ input, photo } = await readPatchInput(request));
  } catch {
    return privateJson({ code: "MALFORMED_REQUEST", error: "Request body is not valid JSON." }, { status: 400 });
  }
  if (input && typeof input === "object" && !Array.isArray(input) &&
    Object.keys(input).every((key) => key === "action" || key === "expectedMutationVersion") &&
    (input as { action?: unknown }).action === "remove" &&
    Number.isInteger((input as { expectedMutationVersion?: unknown }).expectedMutationVersion)) {
    const limitKey = `social-post-edit:${hashActor(access.actor.profileId)}`;
    if (await isLimited(limitKey, limitKey)) {
      return privateJson(
        { code: "RATE_LIMITED", error: "Too many Social post changes. Slow down.", retryable: true },
        { status: 429 },
      );
    }
    try {
      const idempotencyKey = request.headers.get("Idempotency-Key");
      if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) return privateJson({ code: "INVALID_IDEMPOTENCY_KEY", error: "Post request key is not valid." }, { status: 400 });
      const removed = await socialPostStore().remove(postId, access.actor,
        Number((input as { expectedMutationVersion: number }).expectedMutationVersion), idempotencyKey);
      return removed
        ? privateJson({ ok: true })
        : privateJson({ code: "NOT_FOUND", error: "Post not found." }, { status: 404 });
    } catch (error) {
      return storeError(error);
    }
  }
  const validation = parseSocialEditSubmission(input, photo !== null);
  if (!validation.ok) {
    return privateJson({ code: validation.code, error: validation.error }, { status: 400 });
  }
  const limitKey = `social-post-edit:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey)) {
    return privateJson(
      { code: "RATE_LIMITED", error: "Too many Social post changes. Slow down.", retryable: true },
      { status: 429 },
    );
  }
  let uploaded: UploadedSocialPhoto | null = null;
  let reserved: UploadedSocialPhoto | null = null;
  try {
    let changes = validation.changes;
    if (changes.venueId) {
      const venue = await resolveSocialVenueId(changes.venueId);
      if (!venue.ok) {
        return privateJson(
          venue.unavailable
            ? { code: "VENUE_LOOKUP_UNAVAILABLE", error: "Venue search is unavailable right now.", retryable: true }
            : { code: "INVALID_VENUE", error: "Choose a pub from Venue search." },
          { status: venue.unavailable ? 503 : 400 },
        );
      }
      changes = { ...changes, venueId: venue.venueId };
    }
    if (photo) {
      const prepared = await prepareSocialPhoto(photo);
      reserved = await reserveSocialPhotoUpload(access.actor.profileId, prepared);
      uploaded = await uploadPreparedSocialPhoto(
        access.actor.profileId,
        prepared,
        undefined,
        reserved.mediaId,
        reserved.objectKey,
        reserved.generation,
      );
      changes = { ...changes, photo: { mediaId: uploaded.mediaId, altText: validation.photoAltText! } };
    } else if (validation.removePhoto) changes = { ...changes, photo: null };
    const editOptions = uploaded
      ? { media: uploaded, tagHandles: validation.tagHandles }
      : validation.photoAltText
        ? { existingPhotoAltText: validation.photoAltText }
        : undefined;
    const post = editOptions
      ? await socialPostStore().edit(postId, access.actor, validation.expectedMutationVersion, changes,
          validation.moderationSensitive, editOptions)
      : await socialPostStore().edit(postId, access.actor, validation.expectedMutationVersion, changes,
          validation.moderationSensitive);
    return privateJson({
      post: await projectSocialVenueName(post),
      audit: { fromMutationVersion: validation.expectedMutationVersion, toMutationVersion: post.mutationVersion },
    });
  } catch (error) {
    if (reserved) {
      await reconcileSocialPhotoUpload(access.actor.profileId, reserved.mediaId, reserved.generation).catch(() => false);
    }
    if (error instanceof SocialPhotoError) {
      return privateJson({ code: error.code, error: error.message }, { status: error.code === "STORAGE_UNAVAILABLE" ? 503 : 400 });
    }
    return storeError(error);
  }
}
