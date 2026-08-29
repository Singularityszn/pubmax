import { publicApiError } from "@/lib/apiError";
import { isModerator } from "@/lib/adminAuth";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { boundedJson } from "@/lib/boundedRequest.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return publicApiError("Moderator access required.", "FORBIDDEN", 403, { headers: { "Cache-Control": "private, no-store" } });
  try { return json({ posts: await socialPostConsentStore.heldQueueForAdmin(50) }); }
  catch { return publicApiError("Social post moderation is unavailable.", "UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } }); }
}
export async function POST(request: Request): Promise<Response> {
  const limiterKey = `admin-social-posts:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  if (!isModerator(request)) return publicApiError("Moderator access required.", "FORBIDDEN", 403, { headers: { "Cache-Control": "private, no-store" } });
  let input: unknown;
  try { input = await boundedJson(request); } catch { return publicApiError("Moderation request is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } }); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!value || Object.keys(value).length !== 3 || typeof value.postId !== "string" ||
    !UUID.test(value.postId) ||
    (value.mediaId !== null && (typeof value.mediaId !== "string" || !UUID.test(value.mediaId))) ||
    (value.action !== "approve" && value.action !== "hide")) return publicApiError("Moderation request is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  try { await socialPostConsentStore.moderateHeldForAdmin(value.postId, value.mediaId as string | null, value.action); return json({ ok: true }); }
  catch { return publicApiError("Moderator access required.", "FORBIDDEN", 403, { headers: { "Cache-Control": "private, no-store" } }); }
}
