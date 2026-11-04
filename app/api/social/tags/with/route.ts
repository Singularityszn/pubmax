// "With" handle tags on a Pint Drop (lib/pintDropWithTagsStore.ts).
//
// POST proposes: the drop's author names up to six claimed handles. Each one
// becomes a proposal in that person's tag inbox, never a fact on the drop. A
// pair with a block between them is refused silently, so the answer is the
// same `{ ok: true }` whether the tag was written or not.
//
// GET reads what a drop may print: approved handles and a count of the rest.
// It answers only for drops a stranger may read, plus the caller's own.

import { publicApiError } from "@/lib/apiError";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { WITH_TAG_MAX } from "@/lib/pintDropWithTags";
import {
  MAX_SUMMARY_DROPS,
  pintDropWithTagsStore,
  WithTagError,
  type WithTagActor,
} from "@/lib/pintDropWithTagsStore";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import type { SocialPostActor } from "@/lib/socialPostStore";
import { clientIp, hashIp } from "@/lib/supabase";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE });
}

// ONE DOMAIN FOR AUTHORSHIP (review P2, PR 2402). A drop's author is read
// through the handles an AUTH user id holds, so the tag actor carries the
// auth user id the session verified, never the Social actor's `accountId`
// (the private Social account record's own UUID, a different domain).
function withTagActor(access: { actor: SocialPostActor; authUserId: string }): WithTagActor {
  return { profileId: access.actor.profileId, handle: access.actor.handle, accountId: access.authUserId };
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pint-drop-with-tag:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 20)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) {
    return publicApiError(access.error, access.code, access.status, { headers: PRIVATE });
  }
  let input: unknown;
  try {
    input = await boundedJson(request, 4 * 1024);
  } catch {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  const value =
    input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (
    !value ||
    Object.keys(value).length !== 2 ||
    typeof value.dropId !== "string" ||
    !Array.isArray(value.handles) ||
    value.handles.length === 0 ||
    value.handles.length > WITH_TAG_MAX ||
    value.handles.some((handle) => typeof handle !== "string" || handle.length > 40)
  ) {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  try {
    await pintDropWithTagsStore().propose(withTagActor(access), value.dropId, value.handles as string[]);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof WithTagError && error.kind === "invalid") {
      return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
    }
    if (error instanceof WithTagError && error.kind === "not_owner") {
      return publicApiError(error.message, "TAG_ACTION_DENIED", 403, { headers: PRIVATE });
    }
    return publicApiError("Tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, {
      retryable: true,
      headers: PRIVATE,
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const raw = params.get("drops") ?? "";
  const dropIds = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (
    dropIds.length === 0 ||
    dropIds.length > MAX_SUMMARY_DROPS ||
    [...params.keys()].some((key) => key !== "drops")
  ) {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  const limiterKey = `pint-drop-with-read:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 120)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  // A reader with a verified Social account is named, so their own drops and
  // their blocks count. Anybody else reads the public answer.
  let viewer: WithTagActor | null = null;
  try {
    const access = await requireVerifiedSocialActor(request);
    if (access.ok) viewer = withTagActor(access);
  } catch {
    viewer = null;
  }
  try {
    const summaries = await pintDropWithTagsStore().summaries(dropIds, viewer);
    return json({ drops: Object.fromEntries(summaries) });
  } catch {
    return publicApiError("Tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, {
      retryable: true,
      headers: PRIVATE,
    });
  }
}
