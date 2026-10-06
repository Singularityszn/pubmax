import { authUnavailableError, publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { removeNightMomentPhoto } from "@/lib/nightMomentMedia";
import { removeNightMemory } from "@/lib/nightMemoryStore";

type Context = { params: Promise<{ id: string }> };

/**
 * Remove one private Memory the caller owns, with the Moments inside it.
 *
 * The store checks ownership at the table and answers `not_found` for a Memory
 * that is not the caller's, so this door tells a stranger nothing. It returns
 * the storage keys of the photos it removed and this route deletes the bytes,
 * the same split the Moment POST uses when it uploads them.
 */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-memory-remove:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") return authUnavailableError();
  if (verification.status !== "verified") {
    return publicApiError("Sign in to remove a Night Memory.", "UNAUTHENTICATED", 401);
  }
  const ownerId = verification.identity.id;
  const { id } = await context.params;
  const removed = await removeNightMemory(ownerId, id);
  if (!removed.ok) {
    if (removed.reason === "published") {
      return publicApiError(
        "This Memory is behind a published Story. Withdraw the Story first.",
        "CONFLICT",
        409,
      );
    }
    if (removed.reason === "shared") {
      return publicApiError(
        "This Memory holds a Moment somebody else owns, so it stays.",
        "CONFLICT",
        409,
      );
    }
    if (removed.reason === "error") {
      return publicApiError(
        "That Memory could not be removed. Try again.",
        "UNAVAILABLE",
        503,
        { retryable: true },
      );
    }
    return publicApiError("That Memory was not found.", "NOT_FOUND", 404);
  }
  // The photos leave with the rows. A key the storage seam cannot delete is its
  // own failure and never turns a completed removal into a refusal.
  await Promise.all(removed.mediaObjectKeys.map((key) => removeNightMomentPhoto(key, ownerId)));
  return jsonNoStore({ removed: true });
}
