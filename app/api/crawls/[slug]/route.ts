// Author-gated edit/delete for a durable Crawl Story (story 35).
//   PATCH  { handle, title?, summary?, visibility? }  → { story }   (author only)
//   DELETE { handle }                                  → { ok: true } (author only)
//
// AUTHORSHIP ENFORCEMENT SEAM. A DESTRUCTIVE VERB NEEDS A VERIFIED ACTOR, and
// that is the whole of what closed this route. The gate used to be
// `author_handle` equality alone (isAuthor in lib/crawlStoryStore), which was
// honest but weak while there was no auth realm to challenge: every link in the
// chain passed for a request carrying NO Authorization header whenever the
// story's author handle had no linked `profiles.user_id`. resolveMessageHandle
// hands back the self-asserted body handle, decideProfileWrite takes the
// unlinked demo lane, and isAuthor skips its linked-owner check — so a stranger
// who read the author handle off the story page (GET below serves it) could
// rewrite or permanently delete somebody else's crawl. The realm the comment
// was waiting for has arrived, so PATCH and DELETE now ask
// gateHasVerifiedActor, the same question the priced Pint Drop path asks: an
// anonymous caller is 401, whatever handle they claim. A non-author (or a
// missing/blank handle) still gets 403; an unknown slug or an anonymous story
// (no author to match) also 403s — you can never edit a story you don't own.
// A legacy story whose author handle was never linked to an account therefore
// has no editor until that handle is claimed; a permanent-delete path open to
// strangers is the worse of the two.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  deleteCrawlStory,
  getStoryAuthor,
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

// A blank/mismatched handle can never edit — 403 (not 401: there is no auth realm
// to challenge, this is a self-asserted ownership gate).
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
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
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
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
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

// GET-author convenience (used by the story page's owner-aware controls if it ever
// needs a client check). Public info — author_handle is already rendered on the
// page — so no gate. Never 500s: an unknown slug yields { author: null }.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  return jsonNoStore({ author: await getStoryAuthor(slug) }, { status: 200 });
}
