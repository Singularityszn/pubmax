import { publicApiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/boundedRequest.server";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostVideoError, socialPostVideoStore } from "@/lib/socialPostVideoStore";
import { isSocialVideoType, SOCIAL_VIDEO_MAX_BYTES } from "@/lib/socialPostVideos";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/social/videos/uploads { contentType, byteSize }: opens one upload
 * intent and answers with where to PUT the file. The bytes go straight to
 * Storage, never through this function, because a video is far larger than a
 * serverless request body.
 */
export async function POST(request: Request): Promise<Response> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: NO_STORE });
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return publicApiError("Video details are not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!raw || Object.keys(raw).some((key) => key !== "contentType" && key !== "byteSize")) {
    return publicApiError("Video details are not valid.", "INVALID_VIDEO", 400, { headers: NO_STORE });
  }
  if (!isSocialVideoType(raw.contentType)) {
    return publicApiError("Choose an MP4, MOV or WebM video.", "INVALID_VIDEO", 400, { headers: NO_STORE });
  }
  const byteSize = raw.byteSize;
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize < 1 || byteSize > SOCIAL_VIDEO_MAX_BYTES) {
    return publicApiError("Videos can be up to 100 MB.", "VIDEO_TOO_LARGE", 400, { headers: NO_STORE });
  }
  const key = `social-video-upload:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, 10, 60 * 60_000)) {
    return publicApiError("Too many videos for now. Try again later.", "RATE_LIMITED", 429, { retryable: true, headers: NO_STORE });
  }
  try {
    const ticket = await socialPostVideoStore().createUpload(access.actor, raw.contentType, byteSize);
    return Response.json({ upload: { ...ticket, method: "PUT" } }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SocialPostVideoError) {
      const status = error.code === "TOO_MANY_UPLOADS" ? 429 : error.code === "VIDEO_UNAVAILABLE" ? 503 : 400;
      return publicApiError(error.message, error.code, status, { retryable: status !== 400, headers: NO_STORE });
    }
    return publicApiError("Video upload is unavailable right now.", "VIDEO_UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}
