// Explicit overlap on a mate's profile.
//
// GET /api/profiles/[handle]/overlap -> 200 { topFive, wantToTry } (mates only; 403 otherwise)
//
// Two lists of pub names and nothing else: pubs you both rank in your top five,
// and pubs you both want to try. No percentage and no score (ADR 0017), and
// each list is sorted by name so it shows neither person's order.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { readPassportOverlap } from "@/lib/profilePassport.server";
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ handle: string }> },
): Promise<Response> {
  // Mates are the friends graph, so the overlap follows its launch switch.
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  const key = `passport-overlap:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PER_IP_LIMIT, WINDOW_MS)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const result = await readPassportOverlap(request, (await params).handle ?? "");
  if (!result.ok) {
    return publicApiError(result.error, result.code, result.status, { retryable: result.status === 503 });
  }
  return jsonNoStore(result.body, { status: 200 });
}
