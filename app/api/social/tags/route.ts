import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostConsentStoreError, socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { boundedJson } from "@/lib/boundedRequest.server";

const ACTIONS = new Set(["approve", "decline", "withdraw", "cancel"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }

function page(request: Request): { lane: "proposed" | "approved"; cursor: string | null; limit: number } | null {
  const params = new URL(request.url).searchParams;
  const lane = params.get("lane") ?? "proposed";
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 20);
  if ((lane !== "proposed" && lane !== "approved") || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
    [...params.keys()].some((key) => key !== "lane" && key !== "cursor" && key !== "limit")) return null;
  return { lane, cursor, limit };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  const input = page(request);
  if (!input) return json({ code: "MALFORMED_REQUEST", error: "Tag page is not valid." }, 400);
  try { return json(await socialPostConsentStore.tagInbox(access.actor, input)); }
  catch (error) {
    if (error instanceof SocialPostConsentStoreError && /page is not valid/i.test(error.message)) {
      return json({ code: "MALFORMED_REQUEST", error: "Tag page is not valid." }, 400);
    }
    return json({ code: "SOCIAL_TAGS_UNAVAILABLE", error: "Photo tags are unavailable right now." }, 503);
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor();
  if (!access.ok) return json({ code: access.code, error: access.error }, access.status);
  let input: unknown;
  try { input = await boundedJson(request); } catch { return json({ code: "MALFORMED_REQUEST", error: "Tag request is not valid." }, 400); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const expectedKeys = value?.action === "approve" ? 3 : 2;
  if (!value || Object.keys(value).length !== expectedKeys || typeof value.proposalId !== "string" ||
    !UUID.test(value.proposalId) || typeof value.action !== "string" || !ACTIONS.has(value.action)) {
    return json({ code: "MALFORMED_REQUEST", error: "Tag request is not valid." }, 400);
  }
  const expectedAudienceRevision = value.expectedAudienceRevision;
  if (value.action === "approve" && (!Number.isInteger(expectedAudienceRevision) || Number(expectedAudienceRevision) < 0)) {
    return json({ code: "MALFORMED_REQUEST", error: "Review this photo tag again." }, 400);
  }
  try {
    await socialPostConsentStore.actOnTag(
      access.actor,
      value.proposalId,
      value.action as "approve" | "decline" | "withdraw" | "cancel",
      value.action === "approve" ? Number(expectedAudienceRevision) : undefined,
    );
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /audience changed/i.test(error.message)) {
      return json({ code: "TAG_REVIEW_STALE", error: "Review this photo tag again." }, 409);
    }
    return json({ code: "TAG_ACTION_DENIED", error: "Tag choice was not saved." }, 403);
  }
}
