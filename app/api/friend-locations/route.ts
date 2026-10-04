import { publicApiError } from "@/lib/apiError";
import { isCrossSiteRequest } from "@/lib/crossSiteRequest";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { friendLocationId, friendLocationPoint, FRIEND_LOCATION_RECIPIENT_MAX } from "@/lib/friendLocation";
import { FriendLocationError, friendLocationOperation, type FriendLocationOperation } from "@/lib/friendLocationService.server";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { hashActor } from "@/lib/supabase";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const invalid = () => publicApiError("Location request is not valid.", "INVALID_FRIEND_LOCATION", 422, { headers });
function validInput(operation: FriendLocationOperation, input: Record<string, unknown>): boolean {
  const keys = operation === "reconcile" ? ["action", "expectedGeneration"]
    : operation === "start" ? ["recipients", "latitude", "longitude", "accuracy", "expectedGeneration"]
    : operation === "update" ? ["sessionId", "revision", "latitude", "longitude", "accuracy"] : ["sessionId", "revision"];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) return false;
  if (["start", "reconcile"].includes(operation) && (!Number.isSafeInteger(input.expectedGeneration) || Number(input.expectedGeneration) < 0)) return false;
  if (["start", "update"].includes(operation) && !friendLocationPoint(input)) return false;
  if (operation === "start") {
    const recipients = input.recipients;
    return Array.isArray(recipients) && recipients.length > 0 && recipients.length <= FRIEND_LOCATION_RECIPIENT_MAX &&
      recipients.every(friendLocationId) && new Set(recipients).size === recipients.length;
  }
  return operation === "reconcile" || (friendLocationId(input.sessionId) && Number.isSafeInteger(input.revision) && Number(input.revision) >= 1);
}
async function run(request: Request, operation: FriendLocationOperation): Promise<Response> {
  if (operation !== "read" && isCrossSiteRequest(request)) {
    return publicApiError("Location request came from another site.", "CROSS_SITE_REQUEST", 403, { headers });
  }
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers, retryable: access.retryable });
  try {
    const key = `friend-location:${operation}:${hashActor(access.actor.accountId)}`;
    if (await isLimited(key, key, operation === "start" ? 6 : 60, 60_000)) {
      return publicApiError("Too many location requests. Wait a minute.", "RATE_LIMITED", 429, { headers, retryable: true });
    }
    let input: { [key: string]: Json } = {};
    let effectiveOperation = operation;
    if (operation !== "read") {
      const raw = await boundedJson(request, 4 * 1024);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
      input = raw as { [key: string]: Json };
      if (operation === "start" && input.action === "reconcile") effectiveOperation = "reconcile";
      if (!validInput(effectiveOperation, input)) return invalid();
    }
    return Response.json(await friendLocationOperation(access.actor, effectiveOperation, input), { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return invalid();
    if (error instanceof RequestBodyTooLargeError) return publicApiError("Location request is too large.", "REQUEST_TOO_LARGE", 413, { headers });
    if (error instanceof FriendLocationError && error.code !== "unavailable") {
      const status = error.code === "conflict" ? 409 : error.code === "invalid" ? 422 : 403;
      return publicApiError(error.code === "conflict" ? "Sharing changed. Refresh before continuing." : "Location sharing is not allowed.",
        `FRIEND_LOCATION_${error.code.toUpperCase()}`, status, { headers });
    }
    return publicApiError("Location sharing is unavailable. Try again.", "FRIEND_LOCATION_UNAVAILABLE", 503, { headers, retryable: true });
  }
}
export const GET = (request: Request) => run(request, "read");
export const POST = (request: Request) => run(request, "start");
export const PATCH = (request: Request) => run(request, "update");
export const DELETE = (request: Request) => run(request, "revoke");
