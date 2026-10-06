import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { removeNightMomentPhoto } from "@/lib/nightMomentMedia";
import { removeNightMoment } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

/**
 * Remove one private Moment the caller owns.
 *
 * Ownership is checked at the table, so a Moment that is not the caller's reads
 * as not found, the same answer an unknown id gets. A Moment already inside a
 * published Story keeps the path it has: consent withdrawal takes it out of the
 * Story, and only then can its owner remove it here.
 */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-moment-remove:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") return authUnavailableError();
  if (verification.status !== "verified") {
    return publicApiError("Sign in to remove a Night Moment.", "UNAUTHENTICATED", 401);
  }
  const ownerId = verification.identity.id;
  const { id } = await context.params;
  const removed = await removeNightMoment(ownerId, id);
  if (!removed.ok) {
    if (removed.reason === "published") {
      return publicApiError(
        "This Moment is in a published Story. Withdraw your approval first.",
        "CONFLICT",
        409,
      );
    }
    if (removed.reason === "error") {
      return publicApiError(
        "That Moment could not be removed. Try again.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
    return publicApiError("That Moment was not found.", "NOT_FOUND", 404);
  }
  // The photo leaves with the row, through the one storage seam the upload used.
  await Promise.all(removed.mediaObjectKeys.map((key) => removeNightMomentPhoto(key, ownerId)));
  return jsonNoStore({ removed: true });
}
