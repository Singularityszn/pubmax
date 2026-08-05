import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";

const ACTIONS = new Set(["approve", "decline", "withdraw", "cancel"]);
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }

export async function GET(): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  try { return json({ proposals: await socialPostConsentStore.tagInbox(access.actor, 50) }); }
  catch { return json({ code: "SOCIAL_TAGS_UNAVAILABLE", error: "Photo tags are unavailable right now." }, 503); }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  let input: unknown;
  try { input = await request.json(); } catch { return json({ code: "MALFORMED_REQUEST", error: "Tag request is not valid." }, 400); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!value || typeof value.proposalId !== "string" || typeof value.action !== "string" || !ACTIONS.has(value.action)) return json({ code: "MALFORMED_REQUEST", error: "Tag request is not valid." }, 400);
  try {
    await socialPostConsentStore.actOnTag(access.actor, value.proposalId, value.action as "approve" | "decline" | "withdraw" | "cancel");
    return json({ ok: true });
  } catch { return json({ code: "TAG_ACTION_DENIED", error: "Tag choice was not saved." }, 403); }
}
