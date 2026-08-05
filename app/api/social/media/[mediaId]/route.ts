import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { signSocialPhotoObject } from "@/lib/socialPostMedia.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";

type Context = { params: Promise<{ mediaId: string }> };

function missing(): Response {
  return Response.json({ code: "NOT_FOUND", error: "Photo not found." }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return missing();
  const { mediaId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return missing();
  try {
    const objectKey = await socialPostConsentStore.mediaObjectKey(access.actor, mediaId);
    if (!objectKey) return missing();
    const signedUrl = await signSocialPhotoObject(objectKey);
    if (!signedUrl) return missing();
    return new Response(null, { status: 302, headers: { Location: signedUrl, "Cache-Control": "private, no-store" } });
  } catch { return missing(); }
}
