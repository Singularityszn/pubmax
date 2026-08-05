import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { boundedJson } from "@/lib/boundedRequest.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
export async function GET(): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  try { return json({ posts: await socialPostConsentStore.heldQueue(access.actor, 50) }); }
  catch { return json({ code: "FORBIDDEN", error: "Moderator access required." }, 403); }
}
export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  let input: unknown;
  try { input = await boundedJson(request); } catch { return json({ code: "MALFORMED_REQUEST", error: "Moderation request is not valid." }, 400); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!value || Object.keys(value).length !== 3 || typeof value.postId !== "string" ||
    !UUID.test(value.postId) ||
    (value.mediaId !== null && (typeof value.mediaId !== "string" || !UUID.test(value.mediaId))) ||
    (value.action !== "approve" && value.action !== "hide")) return json({ code: "MALFORMED_REQUEST", error: "Moderation request is not valid." }, 400);
  try { await socialPostConsentStore.moderateHeld(access.actor, value.postId, value.mediaId as string | null, value.action); return json({ ok: true }); }
  catch { return json({ code: "FORBIDDEN", error: "Moderator access required." }, 403); }
}
