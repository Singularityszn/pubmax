// People you may know: the signed-in viewer's mates of mates.
//
// GET /api/profiles/may-know -> 200 { people } (the bearer's own list; 401 otherwise)
//
// The rule is lib/peopleYouMayKnow.ts and the read is
// lib/peopleYouMayKnow.server.ts. It follows the friends launch switch,
// because a suggestion is an edge of the friends graph.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { readPeopleYouMayKnow } from "@/lib/peopleYouMayKnow.server";
import { isLimited } from "@/lib/pintDrops";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import { clientIp, hashIp } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PER_IP_LIMIT = 30;
const WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const key = `may-know:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readPeopleYouMayKnow(request);
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore({ people: result.people }, { status: 200 });
}
