import { publicApiError } from "@/lib/apiError";
import { isModerator } from "@/lib/adminAuth";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { socialPostVideoStore } from "@/lib/socialPostVideoStore";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "private, no-store" };

function forbidden(): Response {
  return publicApiError("Moderator access required.", "FORBIDDEN", 403, { headers: NO_STORE });
}

/**
 * GET /api/admin/social-videos: the videos waiting for a person to watch
 * them, oldest first. GET ?postId=... streams one of them for the moderator,
 * whatever its state.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const postId = new URL(request.url).searchParams.get("postId");
  try {
    if (postId) {
      if (!UUID.test(postId)) return publicApiError("Video not found.", "NOT_FOUND", 404, { headers: NO_STORE });
      const playback = await socialPostVideoStore().moderatorPlayback(postId);
      if (!playback) return publicApiError("Video not found.", "NOT_FOUND", 404, { headers: NO_STORE });
      if ("redirect" in playback) return new Response(null, { status: 302, headers: { Location: playback.redirect, ...NO_STORE } });
      return new Response(new Uint8Array(playback.bytes), { headers: { "Content-Type": playback.contentType, ...NO_STORE } });
    }
    return Response.json({ videos: await socialPostVideoStore().heldQueue(50) }, { headers: NO_STORE });
  } catch {
    return publicApiError("Video moderation is unavailable.", "UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}

/** POST /api/admin/social-videos { postId, decision: "approved" | "rejected" }. */
export async function POST(request: Request): Promise<Response> {
  const limiterKey = `admin-social-videos:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 60)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true, headers: NO_STORE });
  }
  if (!isModerator(request)) return forbidden();
  let input: unknown;
  try {
    input = await boundedJson(request);
  } catch {
    return publicApiError("Decision is not valid.", "MALFORMED_REQUEST", 400, { headers: NO_STORE });
  }
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const postId = typeof raw.postId === "string" && UUID.test(raw.postId) ? raw.postId : null;
  const decision = raw.decision === "approved" || raw.decision === "rejected" ? raw.decision : null;
  if (!postId || !decision || Object.keys(raw).length !== 2) {
    return publicApiError("Decision is not valid.", "INVALID_REQUEST", 400, { headers: NO_STORE });
  }
  try {
    const reviewed = await socialPostVideoStore().review(postId, decision);
    return reviewed
      ? Response.json({ ok: true }, { headers: NO_STORE })
      : publicApiError("Video not found.", "NOT_FOUND", 404, { headers: NO_STORE });
  } catch {
    return publicApiError("Video moderation is unavailable.", "UNAVAILABLE", 503, { retryable: true, headers: NO_STORE });
  }
}
