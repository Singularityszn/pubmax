import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostConsentStoreError, socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { projectSocialVenueNames } from "@/lib/socialPostVenue.server";

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  const headers = { "Cache-Control": "private, no-store" };
  if (!access.ok) return Response.json({ code: access.code, error: access.error }, { status: access.status, headers });
  const params = new URL(request.url).searchParams;
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 ||
    [...params.keys()].some((key) => key !== "cursor" && key !== "limit")) {
    return Response.json({ code: "MALFORMED_REQUEST", error: "Owner post page is not valid." }, { status: 400, headers });
  }
  try {
    const page = await socialPostConsentStore.outbox(access.actor, { cursor, limit });
    return Response.json({ ...page, posts: await projectSocialVenueNames(page.posts) }, { headers });
  }
  catch (error) {
    if (error instanceof SocialPostConsentStoreError && /page is not valid/i.test(error.message)) {
      return Response.json({ code: "MALFORMED_REQUEST", error: "Owner post page is not valid." }, { status: 400, headers });
    }
    return Response.json({ code: "SOCIAL_OUTBOX_UNAVAILABLE", error: "Social outbox is unavailable right now." }, { status: 503, headers });
  }
}
