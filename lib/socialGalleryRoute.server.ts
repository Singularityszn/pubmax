import "server-only";

import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { socialGalleryStore } from "@/lib/socialGalleryStore";
import { parseSocialGalleryCreate, parseSocialGalleryEdit } from "@/lib/socialGallerySubmission";
import { SocialPhotoError } from "@/lib/socialPostMedia.server";
import { validSocialPostIdempotencyKey } from "@/lib/socialPostIdempotency.server";
import { SocialPostStoreError, type SocialPostActor } from "@/lib/socialPostStore";
import { projectSocialVenueName, resolveSocialVenueId } from "@/lib/socialPostVenue.server";
import { hashActor } from "@/lib/supabase";

const privateHeaders = { "Cache-Control": "private, no-store" };

export function galleryError(message: string, code: string, status = 400, retryable = false): Response {
  return publicApiError(message, code, status, { retryable, headers: privateHeaders });
}

export function galleryStoreError(error: unknown): Response {
  if (error instanceof SocialPhotoError) {
    const unavailable = error.code === "STORAGE_UNAVAILABLE";
    return galleryError(error.message, error.code, unavailable ? 503 : 400, unavailable);
  }
  if (error instanceof SocialPostStoreError) {
    const status = error.code === "FORBIDDEN" ? 403
      : error.code === "NOT_FOUND" ? 404
        : ["EDIT_CONFLICT", "IDEMPOTENCY_CONFLICT", "GALLERY_UPLOAD_UNAVAILABLE"].includes(error.code) ? 409 : 400;
    return galleryError(error.message, error.code, status);
  }
  return galleryError("Social posts are unavailable right now.", "SOCIAL_POSTS_UNAVAILABLE", 503, true);
}

export async function handleSocialGallerySubmission(
  request: Request,
  actor: SocialPostActor,
  input: unknown,
  postId?: string,
): Promise<Response> {
  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return galleryError("Send galleries as JSON.", "INVALID_GALLERY");
  const key = request.headers.get("Idempotency-Key");
  if (!validSocialPostIdempotencyKey(key)) return galleryError("Post request key is not valid.", "INVALID_IDEMPOTENCY_KEY");
  const validation = postId ? parseSocialGalleryEdit(input) : parseSocialGalleryCreate(input);
  if (!validation.ok) return galleryError(validation.error, validation.code);
  const limitKey = `social-post-${postId ? "edit" : "create"}:${hashActor(actor.profileId)}`;
  if (await isLimited(limitKey, limitKey)) {
    return galleryError(postId ? "Too many Social post changes. Slow down." : "Too many Social posts. Slow down.", "RATE_LIMITED", 429, true);
  }
  try {
    let payload = validation.payload;
    let resolvedVenue = null;
    if (payload.venueId) {
      const venue = await resolveSocialVenueId(payload.venueId);
      if (!venue.ok) return venue.unavailable
        ? galleryError("Venue search is unavailable right now.", "VENUE_LOOKUP_UNAVAILABLE", 503, true)
        : galleryError("Choose a pub from Venue search.", "INVALID_VENUE");
      payload = { ...payload, venueId: venue.venueId };
      resolvedVenue = venue;
    }
    const store = socialGalleryStore();
    if (postId && "expectedMutationVersion" in payload) {
      const { post, audit } = await store.edit(postId, actor, payload, key);
      return Response.json({
        post: await projectSocialVenueName(post, resolvedVenue),
        audit,
      }, { headers: privateHeaders });
    }
    if (!("expectedMutationVersion" in payload)) {
      const post = await store.create(actor, payload, key);
      return Response.json({ post: await projectSocialVenueName(post, resolvedVenue) }, { status: 201, headers: privateHeaders });
    }
    return galleryError("Post request is not valid.", "INVALID_GALLERY");
  } catch (error) {
    return galleryStoreError(error);
  }
}
