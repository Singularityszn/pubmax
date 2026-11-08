// GET  /api/admin/social-safety  the open Social reports and the flagged DMs.
// POST /api/admin/social-safety  resolve a report, mark a flagged DM reviewed,
//                                or suspend or reinstate an account.
//
// Launch plan P0 item 6. Admin-only twice: this route checks the moderator
// door (lib/adminAuth.ts) and names the staff role, and every 0224 function
// refuses a role that is not an active moderator. A suspend writes its audit
// row in the database, in the same transaction as the state change.

import { publicApiError } from "@/lib/apiError";
import { isModerator, moderatorStaffRoleId } from "@/lib/adminAuth";
import { boundedJson } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { parseSafetyModerationAction } from "@/lib/socialSafetyModeration";
import { createSocialSafetyStore } from "@/lib/socialSafetyModerationStore";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store" } as const;
const store = createSocialSafetyStore();

function forbidden(): Response {
  return publicApiError("Moderator access required.", "FORBIDDEN", 403, { headers: PRIVATE });
}

function unavailable(): Response {
  return publicApiError("Safety moderation is unavailable.", "UNAVAILABLE", 503, {
    retryable: true,
    headers: PRIVATE,
  });
}

export async function GET(request: Request): Promise<Response> {
  if (!isModerator(request)) return forbidden();
  const staffRoleId = moderatorStaffRoleId(request);
  if (!staffRoleId) return unavailable();
  try {
    return Response.json(await store.queues(staffRoleId), { headers: PRIVATE });
  } catch {
    return unavailable();
  }
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `admin-social-safety:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 60)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  if (!isModerator(request)) return forbidden();
  const staffRoleId = moderatorStaffRoleId(request);
  if (!staffRoleId) return unavailable();
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {
    return publicApiError("Moderation request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  const input = parseSafetyModerationAction(body);
  if (!input) {
    return publicApiError("Moderation request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
  }
  try {
    const result = await store.act(staffRoleId, input);
    if ("evidence" in result) {
      if (!result.evidence) {
        return publicApiError("That reported evidence is unavailable.", "NOT_FOUND", 404, { headers: PRIVATE });
      }
      return Response.json({ evidence: result.evidence }, { headers: PRIVATE });
    }
    if ("code" in result) {
      if (result.code === "invalid") {
        return publicApiError("Moderation request is not valid.", "MALFORMED_REQUEST", 400, { headers: PRIVATE });
      }
      if (result.code === "not_found") {
        return publicApiError("That person has no account to suspend.", "NOT_FOUND", 404, { headers: PRIVATE });
      }
      if (result.code === "gone") {
        return publicApiError("That account was deleted.", "GONE", 409, { headers: PRIVATE });
      }
      return Response.json({ ok: true, code: result.code, state: result.state }, { headers: PRIVATE });
    }
    return Response.json({ ok: true, changed: result.changed }, { headers: PRIVATE });
  } catch {
    return unavailable();
  }
}
