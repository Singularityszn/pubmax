import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { socialPostConsentStore } from "@/lib/socialPostConsentStore";

export async function GET(): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.ok) return Response.json({ code: access.code, error: access.error }, { status: access.status, headers });
  try { return Response.json({ posts: await socialPostConsentStore.outbox(access.actor, 50) }, { headers }); }
  catch { return Response.json({ code: "SOCIAL_OUTBOX_UNAVAILABLE", error: "Social outbox is unavailable right now." }, { status: 503, headers }); }
}
