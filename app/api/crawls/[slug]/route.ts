// Author-gated edit/delete for a durable Crawl Story (story 35).
//   PATCH  { handle, title?, summary?, visibility? }  → { story }   (author only)
//   DELETE { handle }                                  → { ok: true } (author only)
//
// PATCH and DELETE require a verified actor before checking profile ownership.
// isAuthor in lib/crawlStoryStore.ts resolves the story's owner. A public handle
// alone is never proof. Anonymous callers receive 401. A non-author, an unknown
// slug and a story without a proved owner receive the same 403.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import {
  deleteCrawlStory,
  readCrawlStoryBySlug,
  isAuthor,
  updateCrawlStory,
} from "@/lib/crawlStoryStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction, gateHasVerifiedActor } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";

assertServerEnv();

const MAX_TITLE = 120;
const MAX_SUMMARY = 280;

// Ownership refusals do not reveal whether the slug exists.
function forbidden(): Response {
  return publicApiError("You can only edit a crawl you authored.", "FORBIDDEN", 403);
}

// The unlinked demo lane in profile ownership allows a write with no signed-in
// caller, so an allowed gate is not by itself an attributable one. Both verbs
// here change or destroy somebody else's record, so both ask for the actor
// rather than accepting the handle as its own proof. ONE sentence covers both:
// an attacker must not learn from the refusal which verb they reached.
function signInRequired(): Response {
  return publicApiError(
    "Sign in to change a crawl you authored.",
    "UNAUTHENTICATED",
    401,
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const addressKey = `crawl-edit-ip:${hashIp(clientIp(request))}`;
  if (await isLimited(addressKey, addressKey, 120, 60_000)) return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, { retryable: true });
  let body: Record<string, unknown>;
  try {
    body = (await boundedJson(request)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return publicApiError("Request body is too large.", "PAYLOAD_TOO_LARGE", 413);
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  // JWT-linked handle wins over a self-asserted body.handle when signed in.
  const handle = await resolveMessageHandle(request, readString(body.handle));
  if (!handle) return forbidden();

  // Linked-handle ownership: a claimed handle cannot be forged via body.handle.
  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // Asked BEFORE the rate limit, so an anonymous caller spends no budget the
  // signed-in author's own key shares.
  if (!gateHasVerifiedActor(ownership)) return signInRequired();

  // Rate-limit edits per handle + hashed IP so the edit path can't be hammered.
  const key = `crawl-edit:${ownership.handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many edits, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Author gate — use the normalized handle from gateHandleAction; for linked
  // authors, isAuthor also verifies the JWT owner matches the profile link.
  if (!(await isAuthor(slug, ownership.handle, ownership.callerUserId))) return forbidden();

  const patch: { title?: string; summary?: string; visibility?: unknown } = {};
  if ("title" in body) patch.title = readString(body.title)?.slice(0, MAX_TITLE) ?? "";
  if ("summary" in body) patch.summary = readString(body.summary)?.slice(0, MAX_SUMMARY) ?? "";
  if ("visibility" in body) patch.visibility = body.visibility;

  const story = await updateCrawlStory(slug, ownership.handle, patch as never, ownership.callerUserId);
  if (!story) {
    return publicApiError("Could not update this crawl.", "INVALID_REQUEST", 400);
  }
  return jsonNoStore({ story }, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const addressKey = `crawl-delete-ip:${hashIp(clientIp(request))}`;
  if (await isLimited(addressKey, addressKey, 120, 60_000)) return publicApiError("Too many deletes, slow down.", "RATE_LIMITED", 429, { retryable: true });
  let body: Record<string, unknown> = {};
  try {
    body = (await boundedJson(request)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return publicApiError("Request body is too large.", "PAYLOAD_TOO_LARGE", 413);
    // A DELETE may carry no body; the handle can still arrive via a query param.
  }
  // JWT-linked handle wins over a self-asserted body/query handle when signed in.
  const handle = await resolveMessageHandle(
    request,
    readString(body.handle) ?? readString(new URL(request.url).searchParams.get("handle")),
  );
  if (!handle) return forbidden();

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  if (!gateHasVerifiedActor(ownership)) return signInRequired();

  const key = `crawl-del:${ownership.handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many deletes, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  if (!(await isAuthor(slug, ownership.handle, ownership.callerUserId))) return forbidden();

  const ok = await deleteCrawlStory(slug, ownership.handle, ownership.callerUserId);
  if (!ok) return publicApiError("Could not delete this crawl.", "INVALID_REQUEST", 400);
  return jsonNoStore({ ok: true }, { status: 200 });
}

// GET exposes only public attribution through readCrawlStoryBySlug. Hidden and
// unknown slugs receive the same 404. A failed read returns retryable 503.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const result = await readCrawlStoryBySlug(slug);
  if (result.status === "unavailable") return publicApiError("Could not load this crawl. Try again.", "UNAVAILABLE", 503, { retryable: true });
  if (result.status === "absent") return publicApiError("Crawl not found.", "NOT_FOUND", 404);
  return jsonNoStore({ author: result.story.authorHandle }, { status: 200 });
}
