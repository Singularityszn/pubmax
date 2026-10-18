import { publicApiError } from "@/lib/apiError";
import { boundedFormData } from "@/lib/boundedRequest.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialExtraPhotoError, socialPostExtraPhotoStore } from "@/lib/socialPostExtraPhotoStore";
import { prepareSocialPhoto, SOCIAL_PHOTO_MAX_BYTES, SocialPhotoError } from "@/lib/socialPostMedia.server";
import { isSocialPostExtraSlot } from "@/lib/socialPostPhotos";
import { socialPostStore } from "@/lib/socialPostStore";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ postId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

function cleanAlt(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return text || null;
}

/**
 * POST /api/social/posts/:postId/photos (multipart: photo, altText, slot):
 * adds photo 2, 3 or 4 to the caller's own post. One photo a request, so no
 * request nears a serverless body limit. The photo is normalised by the same
 * pipeline as the first, then screened on its own before anybody else sees it.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: NO_STORE });
  const { postId } = await context.params;
  if (!UUID.test(postId)) return publicApiError("Post not found.", "NOT_FOUND", 404, { headers: NO_STORE });
  const key = `social-extra-photo:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, 40, 60 * 60_000)) {
    return publicApiError("Too many photos for now. Try again later.", "RATE_LIMITED", 429, { retryable: true, headers: NO_STORE });
  }
  let form: FormData;
  try {
    form = await boundedFormData(request, SOCIAL_PHOTO_MAX_BYTES + 64 * 1024);
  } catch {
    return publicApiError("Photo request is not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  if ([...form.keys()].some((name) => name !== "photo" && name !== "altText" && name !== "slot")) {
    return publicApiError("Photo request is not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  const photo = form.get("photo");
  const altText = cleanAlt(form.get("altText"));
  const slot = Number(form.get("slot"));
  if (!(photo instanceof File)) return publicApiError("Choose a photo.", "INVALID_PHOTO", 400, { headers: NO_STORE });
  if (!altText) return publicApiError("Add photo alt text.", "PHOTO_ALT_REQUIRED", 400, { headers: NO_STORE });
  if (!isSocialPostExtraSlot(slot)) return publicApiError("A post holds up to four photos.", "INVALID_SLOT", 400, { headers: NO_STORE });
  try {
    // The caller's own post, with its first photo, whichever store answers.
    const post = await socialPostStore().readOwned(postId, access.actor);
    if (!post || !post.ownedByViewer) return publicApiError("Post not found.", "NOT_FOUND", 404, { headers: NO_STORE });
    if (!post.photo) return publicApiError("Add the first photo before more.", "FIRST_PHOTO_REQUIRED", 409, { headers: NO_STORE });
    const prepared = await prepareSocialPhoto(photo);
    const attached = await socialPostExtraPhotoStore().attach(access.actor, postId, slot, prepared, altText);
    return Response.json({ photo: attached }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SocialPhotoError) {
      const unavailable = error.code === "STORAGE_UNAVAILABLE";
      return publicApiError(error.message, error.code, unavailable ? 503 : 400, { retryable: unavailable, headers: NO_STORE });
    }
    if (error instanceof SocialExtraPhotoError) {
      const status = error.code === "SLOT_TAKEN" ? 409 : error.code === "PHOTO_NOT_FOUND" ? 404 : error.code === "PHOTO_UNAVAILABLE" ? 503 : 400;
      return publicApiError(error.message, error.code, status, { retryable: status === 503, headers: NO_STORE });
    }
    return publicApiError("Photos are unavailable right now.", "PHOTO_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}
