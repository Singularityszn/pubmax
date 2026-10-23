import { publicApiError } from "@/lib/apiError";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostExtraPhotoStore } from "@/lib/socialPostExtraPhotoStore";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ mediaId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * GET /api/social/photos/:mediaId: photo 2, 3 or 4 of a post, checked against
 * the reader on every request and served same-origin, as the first photo is
 * through /api/social/media.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return withAuthResumeCookie(await serve(access, context), access.resumeCookie);
}

async function serve(
  access: Awaited<ReturnType<typeof requireVerifiedSocialActor>>,
  context: Context,
): Promise<Response> {
  if (!access.ok) return missing();
  const key = `social-extra-photo-read:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, 240, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    const image = await socialPostExtraPhotoStore().read(access.actor, mediaId);
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
  } catch {
    return missing();
  }
}
