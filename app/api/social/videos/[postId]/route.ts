import { publicApiError } from "@/lib/apiError";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostStore } from "@/lib/socialPostStore";
import { socialPostVideoStore } from "@/lib/socialPostVideoStore";
import { rangedVideoResponse } from "@/lib/socialVideoRange";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ postId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Video not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * GET /api/social/videos/:postId: checks, on every request, that the reader
 * may read the post and may see its video (approved, or their own), then
 * hands over a two-minute Storage URL. A <video> carries no bearer, so this
 * is also the resume-cookie lane's door, as /api/social/media is for photos.
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return withAuthResumeCookie(await serve(request, access, context), access.resumeCookie);
}

async function serve(
  request: Request,
  access: Awaited<ReturnType<typeof requireVerifiedSocialActor>>,
  context: Context,
): Promise<Response> {
  if (!access.ok) return missing();
  const { postId } = await context.params;
  if (!UUID.test(postId)) return missing();
  const key = `social-video-play:${hashActor(access.actor.profileId)}`;
  if (await isLimited(key, key, 240, 60_000)) return missing();
  try {
    const post = await socialPostStore().read(postId, access.actor);
    if (!post) return missing();
    const playback = await socialPostVideoStore().playback(postId, access.actor);
    if (!playback) return missing();
    if ("redirect" in playback) {
      return new Response(null, { status: 302, headers: { Location: playback.redirect, "Cache-Control": "private, no-store" } });
    }
    return rangedVideoResponse(playback.bytes, playback.contentType, request.headers.get("range"));
  } catch {
    return missing();
  }
}
