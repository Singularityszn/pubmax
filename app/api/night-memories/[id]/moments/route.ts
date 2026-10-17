import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { boundedFormData, boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import {
  removeNightMomentPhoto,
  signedNightMomentPhotoUrl,
  uploadNightMomentPhoto,
} from "@/lib/nightMomentMedia";
import { PhotoRefusalError } from "@/lib/pintDropsStore";
import { NIGHT_MEMORY_REFUSED_CODE } from "@/lib/momentPhotoIntake";
import { addNightMoment, listNightMoments } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import {
  UPLOAD_FIELDS_ALLOWANCE_BYTES,
  UPLOAD_PHOTO_MAX_BYTES,
  UPLOAD_PHOTO_MAX_LABEL,
} from "@/lib/uploadBodyLimit";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") {
    return authUnavailableError();
  }
  const ownerId = verification.status === "verified" ? verification.identity.id : null;
  if (!ownerId) return publicApiError("Sign in to view Night Moments.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const moments = await listNightMoments(ownerId, id);
  return jsonNoStore({
    moments: await Promise.all(moments.map(async (moment) => ({
      ...moment,
      mediaUrl: await signedNightMomentPhotoUrl(moment.mediaObjectKey, moment.ownerId),
    }))),
  });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-moment-create:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Solo-operator emergency freeze (U15): posting a Night Moment is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") {
    return authUnavailableError();
  }
  const ownerId = verification.status === "verified" ? verification.identity.id : null;
  if (!ownerId) return publicApiError("Sign in to add a Night Moment.", "UNAUTHENTICATED", 401);
  const { id } = await context.params;
  const contentType = request.headers.get("content-type") ?? "";
  let body: unknown;
  let uploadedKey: string | null = null;
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      // One photo and its few fields: nothing past that is buffered.
      form = await boundedFormData(request, UPLOAD_PHOTO_MAX_BYTES + UPLOAD_FIELDS_ALLOWANCE_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return publicApiError(`Photo must be ${UPLOAD_PHOTO_MAX_LABEL} or smaller.`, "TOO_LARGE", 413);
      }
      return publicApiError("That photo could not be read.", "INVALID_REQUEST", 400);
    }
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return publicApiError("Choose a photo for this Moment.", "INVALID_REQUEST", 400);
    }
    try {
      uploadedKey = await uploadNightMomentPhoto(ownerId, id, photo);
    } catch (error) {
      // Only a refusal about the file itself is the caller's to hear. Every
      // other failure is Storage or config, so its text (raw Supabase wording)
      // never leaves the server and the caller gets one fixed retryable 503.
      if (error instanceof PhotoRefusalError) {
        return publicApiError(error.message, "INVALID_REQUEST", 400);
      }
      return publicApiError(
        "That photo could not be saved. Your draft is safe. Try again.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
    body = {
      kind: "photo",
      caption: form.get("caption"),
      venueId: form.get("venueId"),
      occurredAt: form.get("occurredAt"),
      // Author-written photo description from the capture surface. Optional at
      // save time (a photo can be kept privately without one); it only becomes
      // REQUIRED at publication (the publish gate), never for a private save.
      altText: form.get("altText"),
    };
  } else {
    try {
      body = await boundedJson(request);
    } catch {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
  }
  let writeFailed = false;
  const moment = await addNightMoment(ownerId, id, body, {
    mediaObjectKey: uploadedKey,
  }).catch(async () => {
    writeFailed = true;
    if (uploadedKey) await removeNightMomentPhoto(uploadedKey, ownerId);
    return null;
  });
  if (!moment && uploadedKey) await removeNightMomentPhoto(uploadedKey, ownerId);
  return moment
    ? jsonNoStore({
        moment: {
          ...moment,
          mediaUrl: await signedNightMomentPhotoUrl(moment.mediaObjectKey, moment.ownerId),
        },
      }, { status: 201 })
    : writeFailed
      ? publicApiError("That Moment could not be saved. Your draft is safe.", "UNAVAILABLE", 503, { retryable: true })
      // Its own code, because the composer keeps its Memory id across a refusal
      // about the PHOTO and drops it only for a refusal about the MEMORY.
      : publicApiError("That Memory cannot accept this Moment.", NIGHT_MEMORY_REFUSED_CODE, 400);
}
