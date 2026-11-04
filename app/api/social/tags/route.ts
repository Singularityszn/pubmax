import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostConsentStoreError, socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isSocialTagKind, type SocialTagKind } from "@/lib/pintDropWithTags";
import { pintDropWithTagsStore, WithTagError } from "@/lib/pintDropWithTagsStore";

// Two tag kinds share this inbox. "photo" (the default, so every existing
// caller is unchanged) is a Social post photo tag. "with" is a Pint Drop's
// "With" handle tag (lib/pintDropWithTagsStore.ts). Both are proposals the
// person tagged approves or declines, and either can be taken back.

const ACTIONS = new Set(["approve", "decline", "withdraw", "cancel"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE = { "Cache-Control": "private, no-store" } as const;
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function isAction(value: unknown): value is "approve" | "decline" | "withdraw" | "cancel" {
  return typeof value === "string" && ACTIONS.has(value);
}

function page(request: Request): { kind: SocialTagKind; lane: "proposed" | "approved"; cursor: string | null; limit: number } | null {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") ?? "photo";
  const lane = params.get("lane") ?? "proposed";
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 20);
  if (!isSocialTagKind(kind) || (lane !== "proposed" && lane !== "approved") || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
    [...params.keys()].some((key) => key !== "kind" && key !== "lane" && key !== "cursor" && key !== "limit")) return null;
  return { kind, lane, cursor, limit };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers: PRIVATE });
  const input = page(request);
  if (!input) return publicApiError("Tag page is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  const { kind, ...lanePage } = input;
  if (kind === "with") {
    try { return json(await pintDropWithTagsStore().inbox(access.actor, lanePage)); }
    catch (error) {
      if (error instanceof WithTagError && error.kind === "invalid") {
        return publicApiError("Tag page is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
      }
      return publicApiError("Tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, { retryable: true, headers: PRIVATE });
    }
  }
  try { return json(await socialPostConsentStore.tagInbox(access.actor, lanePage)); }
  catch (error) {
    if (error instanceof SocialPostConsentStoreError && /page is not valid/i.test(error.message)) {
      return publicApiError("Tag page is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
    }
    return publicApiError("Photo tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, { retryable: true, headers: PRIVATE });
  }
}

/** A "with" tag choice: `{ kind: "with", proposalId, action }` and nothing else. */
async function actOnWithTag(
  actor: Parameters<ReturnType<typeof pintDropWithTagsStore>["act"]>[0],
  value: Record<string, unknown>,
): Promise<Response> {
  if (Object.keys(value).length !== 3 || typeof value.proposalId !== "string" ||
    !UUID.test(value.proposalId) || !isAction(value.action)) {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  try {
    await pintDropWithTagsStore().act(actor, value.proposalId, value.action);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof WithTagError && error.kind === "unavailable") {
      return publicApiError("Tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, { retryable: true, headers: PRIVATE });
    }
    return publicApiError("Tag choice was not saved.", "TAG_ACTION_DENIED", 403, { headers: PRIVATE });
  }
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `social-tag-action:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers: PRIVATE });
  let input: unknown;
  try { input = await boundedJson(request); } catch { return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE }); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (value && value.kind === "with") return actOnWithTag(access.actor, value);
  const expectedKeys = value?.action === "approve" ? 3 : 2;
  if (!value || Object.keys(value).length !== expectedKeys || typeof value.proposalId !== "string" ||
    !UUID.test(value.proposalId) || typeof value.action !== "string" || !ACTIONS.has(value.action)) {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  const expectedAudienceRevision = value.expectedAudienceRevision;
  if (value.action === "approve" && (!Number.isInteger(expectedAudienceRevision) || Number(expectedAudienceRevision) < 0)) {
    return publicApiError("Review this photo tag again.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
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
      return publicApiError("Review this photo tag again.", "TAG_REVIEW_STALE", 409, { headers: PRIVATE });
    }
    return publicApiError("Tag choice was not saved.", "TAG_ACTION_DENIED", 403, { headers: PRIVATE });
  }
}
