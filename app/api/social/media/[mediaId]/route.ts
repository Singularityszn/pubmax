import { publicApiError } from "@/lib/apiError";
import { withAuthResumeCookie } from "@/lib/authSessionResume";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { downloadUploadedImageObject } from "@/lib/uploadedImage.server";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { socialLondonLaneOpen } from "@/lib/socialLondonLane.server";
import { socialPostStore } from "@/lib/socialPostStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

type Context = { params: Promise<{ mediaId: string }> };
type VerifiedAccess = Extract<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function missing(): Response {
  return publicApiError("Photo not found.", "NOT_FOUND", 404, { headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  // An <img> carries no bearer, so this is the resume-cookie lane's main door:
  // every answer hands back the token it rotated, refusals included.
  const response = access.ok ? await serve(access, context) : await serveLondonLane(request, context);
  return withAuthResumeCookie(response, access.resumeCookie);
}

async function serve(access: VerifiedAccess, context: Context): Promise<Response> {
  const limitKey = `social-media-sign:${hashActor(access.actor.profileId)}`;
  if (await isLimited(limitKey, limitKey, 120, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    return await deliver(await socialPostConsentStore.mediaObjectKey(access.actor, mediaId));
  } catch { return missing(); }
}

/**
 * THE SIGNED-OUT DOOR, for the London lane's photos only (captain decision 7,
 * 1 Nov 2026). It asks nothing about the reader, because the lane is the same
 * for everybody: the store answers whether this is the first photo of a post
 * the lane shows (`londonLaneHasPhoto`, the lane's own rule), and the consent
 * store, read for nobody, answers with an approved, attached photo of a public
 * post or nothing. It is limited per IP and closes with the lane.
 */
async function serveLondonLane(request: Request, context: Context): Promise<Response> {
  if (!socialLondonLaneOpen()) return missing();
  // One lane page can carry 20 photos, so this takes the photo-read budget
  // (`social-extra-photo-read`, 240 a minute) rather than the signing one.
  const limitKey = `social-london-media:${hashIp(clientIp(request))}`;
  if (await isLimited(limitKey, limitKey, 240, 60_000)) return missing();
  const { mediaId } = await context.params;
  if (!UUID.test(mediaId)) return missing();
  try {
    if (!(await socialPostStore().londonLaneHasPhoto(mediaId))) return missing();
    return await deliver(await socialPostConsentStore.mediaObjectKey(null, mediaId));
  } catch { return missing(); }
}

async function deliver(objectKey: string | null): Promise<Response> {
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
}
