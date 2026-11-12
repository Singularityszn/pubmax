// A handle's notifications / activity inbox (story 34 / Wave I2).
//   GET  ?handle=<handle>            → { notifications: NotificationDTO[], unread, mapFixes }
//   POST { handle, id? }             → { notifications, unread }   (marks read)
//
// Wave I2: resolve the actor via resolveMessageHandle (JWT-linked handle wins)
// then gateHandleAction. A read, including the inbox a mark-read returns, is
// allowed only when the caller's account owns the handle. An unowned row and
// a tombstone are the same refusal as a handle owned by somebody else. A
// notification can include private crew membership activity. The event
// vocabulary lives in lib/notifications.ts.
//
// `mapFixes` are the owner's accepted map fixes (lib/mapFixOutcomes.ts): a pub
// they named that was accepted, or a note they left that was fixed. They ride the
// bell's existing poll, so hearing back costs no extra request.
//
// Reads are fail-soft (the store returns an empty inbox on any error), so a
// notifications outage can never 500 the bell / activity page. Store choice is the
// usual seam: Supabase when configured, process-memory otherwise.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { listMapFixOutcomes } from "@/lib/mapFixOutcomes.server";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { notificationsStore } from "@/lib/notificationsStore";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { readString } from "@/lib/textClean";

assertServerEnv();

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const asserted = new URL(request.url).searchParams.get("handle") ?? "";
  const handle = await resolveMessageHandle(request, asserted);
  if (!handle) return jsonNoStore({ notifications: [], unread: 0, mapFixes: [], mapFixesComplete: false }, { status: 200 });
  const ownership = await gateHandleAction(request, handle, undefined, {
    requireAccountOwner: true,
  });
  if (!ownership.allowed) {
    // Fail-soft on store outage: empty bell keeps chrome rendering.
    if (ownership.status === 503) {
      return jsonNoStore({ notifications: [], unread: 0, mapFixes: [], mapFixesComplete: false }, { status: 200 });
    }
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }
  const [inbox, mapFixes] = await Promise.all([
    notificationsStore().list(handle),
    ownership.callerUserId ? listMapFixOutcomes(ownership.callerUserId) : Promise.resolve({ outcomes: [], complete: false }),
  ]);
  return jsonNoStore({ ...inbox, mapFixes: mapFixes.outcomes, mapFixesComplete: mapFixes.complete }, { status: 200 });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return publicApiError("Add a handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle, undefined, {
    requireAccountOwner: true,
  });
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  const key = `notif-read:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many updates, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const id = readString(body.id);
  const inbox = await notificationsStore().markRead(handle, id);
  return jsonNoStore(inbox, { status: 200 });
}
