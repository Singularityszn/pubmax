import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { downloadUploadedImageObject } from "@/lib/uploadedImage.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { isLimited } from "@/lib/pintDrops";
import { hashActor } from "@/lib/supabase";

type Context = { params: Promise<{ mediaId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
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
    // A copied Storage grant would bypass later audience or consent changes.
    // Keep delivery behind the current permission check on every request.
    const image = await downloadUploadedImageObject(objectKey);
    if (!image) return missing();
    return new Response(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch { return missing(); }
}
