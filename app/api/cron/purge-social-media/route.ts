import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import {
  purgeDetachedSocialPhotos,
  purgeOrphanedSocialPhotoUploads,
} from "@/lib/socialPostMedia.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  try {
    const [detached, orphaned] = await Promise.all([
      purgeDetachedSocialPhotos(50),
      purgeOrphanedSocialPhotoUploads(50),
    ]);
    return jsonNoStore({ ok: true, detached, orphaned });
  } catch {
    return jsonNoStore({
      ok: false,
      error: "Social photo cleanup is unavailable.",
      retryable: true,
    }, { status: 503 });
  }
}
