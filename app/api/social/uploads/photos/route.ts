import { assertServerEnv } from "@/lib/serverEnv";
import { boundedFormData, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { isLimited } from "@/lib/pintDrops";
import { hashActor } from "@/lib/supabase";
import { validSocialPostIdempotencyKey } from "@/lib/socialPostIdempotency.server";
import { socialGalleryStore } from "@/lib/socialGalleryStore";
import { SOCIAL_GALLERY_MAX_PHOTOS } from "@/lib/socialGallery";
import { galleryError, galleryStoreError } from "@/lib/socialGalleryRoute.server";
import { photoFitsUploadBody, UPLOAD_PHOTO_MAX_BYTES, UPLOAD_FIELDS_ALLOWANCE_BYTES } from "@/lib/uploadBodyLimit";

assertServerEnv();

export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return galleryError(access.error, access.code, access.status, access.retryable === true);
  const key = request.headers.get("Idempotency-Key");
  if (!validSocialPostIdempotencyKey(key)) return galleryError("Post request key is not valid.", "INVALID_IDEMPOTENCY_KEY");
  const limitKey = `social-gallery-upload:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, SOCIAL_GALLERY_MAX_PHOTOS * 3, 60_000)) {
    return galleryError("Too many photo uploads. Slow down.", "RATE_LIMITED", 429, true);
  }
  let photo: File;
  try {
    const form = await boundedFormData(request, UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES);
    const parts = form.getAll("photo");
    if ([...form.keys()].some((name) => name !== "photo") || parts.length !== 1 || !(parts[0] instanceof File)) {
      return galleryError("Send one photo per upload.", "MALFORMED_REQUEST");
    }
    photo = parts[0];
    if (!photoFitsUploadBody(photo.size)) return galleryError("Photo must be 4 MB or smaller.", "TOO_LARGE");
    if (!["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
      return galleryError("Photo must be a JPEG, PNG, or WebP image.", "INVALID_TYPE");
    }
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? galleryError("Photo must be 4 MB or smaller.", "TOO_LARGE", 413)
      : galleryError("Send one photo per upload.", "MALFORMED_REQUEST");
  }
  try {
    const upload = await socialGalleryStore().upload(access.actor, photo, key);
    return Response.json({ upload }, {
      status: 201, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return galleryStoreError(error);
  }
}
