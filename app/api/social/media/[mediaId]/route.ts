import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialMediaMetadata } from "@/lib/socialMediaPolicy";
import { signSocialPhotoObject, readMemorySocialMedia } from "@/lib/socialPostMedia.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { isLimited } from "@/lib/pintDrops";
import { hashActor, isSupabaseConfigured } from "@/lib/supabase";

type Context = { params: Promise<{ mediaId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Media not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return missing();
  const limitKey = `social-media-sign:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, 120, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    const objectKey = await socialPostConsentStore.mediaObjectKey(access.actor, mediaId);
    if (!objectKey) return missing();
    const contentType = objectKey.endsWith("/video.mp4") ? "video/mp4" : "image/jpeg";
    const json = (new URL(request.url).searchParams.get("format") === "json" || request.headers.get("accept")?.includes("application/json") === true);
    if (!isSupabaseConfigured()) {
      const media = readMemorySocialMedia(objectKey);
      if (!media) return missing();
      if (json) return Response.json({ url: `/api/social/media/${mediaId}`, ...socialMediaMetadata(contentType) }, { headers: { "Cache-Control": "private, no-store" } });
      const headers = { "Content-Type": media.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes" };
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        const size = media.bytes.length;
        const start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2]));
        const end = match?.[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
          return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
        }
        return new Response(new Uint8Array(media.bytes.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
      }
      return new Response(new Uint8Array(media.bytes), { headers: { ...headers, "Content-Length": String(media.bytes.length) } });
    }
    const signedUrl = await signSocialPhotoObject(objectKey);
    if (!signedUrl) return missing();
    if (json) return Response.json({ url: signedUrl, ...socialMediaMetadata(contentType) }, { headers: { "Cache-Control": "private, no-store" } });
    return new Response(null, { status: 302, headers: { Location: signedUrl, "Cache-Control": "private, no-store" } });
  } catch { return missing(); }
}
