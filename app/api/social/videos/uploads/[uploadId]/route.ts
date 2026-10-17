import { publicApiError } from "@/lib/apiError";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { memoryVideoUploadReceiver } from "@/lib/socialPostVideoStore";
import { SOCIAL_VIDEO_MAX_BYTES } from "@/lib/socialPostVideos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ uploadId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * PUT /api/social/videos/uploads/:id: the KEYLESS stand-in for the Storage
 * upload URL, so `npm run dev` can post a video with no Supabase. With Storage
 * configured the intent hands out a Storage URL instead and this door answers
 * 404 for every id.
 */
export async function PUT(request: Request, context: Context): Promise<Response> {
  const receiver = memoryVideoUploadReceiver();
  if (!receiver) return publicApiError("Upload not found.", "NOT_FOUND", 404, { headers: NO_STORE });
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers: NO_STORE });
  const { uploadId } = await context.params;
  if (!UUID.test(uploadId)) return publicApiError("Upload not found.", "NOT_FOUND", 404, { headers: NO_STORE });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > SOCIAL_VIDEO_MAX_BYTES) return publicApiError("Videos can be up to 100 MB.", "VIDEO_TOO_LARGE", 413, { headers: NO_STORE });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const stored = await receiver.receiveUpload(access.actor, uploadId, bytes);
  return stored
    ? new Response(null, { status: 204, headers: NO_STORE })
    : publicApiError("Upload not found.", "NOT_FOUND", 404, { headers: NO_STORE });
}
