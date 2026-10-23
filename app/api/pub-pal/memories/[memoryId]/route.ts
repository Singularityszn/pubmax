import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { deletePalMemoryResult, palMemoryExpectedValue, updatePalMemoryResult } from "@/lib/pubPalStore";

type Context = { params: Promise<{ memoryId: string }> };

function unauthenticated(): Response {
  return publicApiError("Sign in to manage Pal memory.", "AUTH_REQUIRED", 401);
}

/** A card that names the value it replaces is stale once the memory has changed. */
function changedSinceCard(): Response {
  return publicApiError("That memory has changed since this card was made.", "PAL_MEMORY_CHANGED", 409);
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const limiterKey = `pub-pal-memories:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  let body: unknown;
  try { body = await request.json(); }
  catch { return publicApiError("Malformed request body.", "INVALID_JSON", 400); }
  const { memoryId } = await context.params;
  const result = await updatePalMemoryResult(ownerId, memoryId, body);
  if (result.ok) return jsonNoStore({ memory: result.value });
  if (result.error === "conflict") return changedSinceCard();
  return result.error === "error"
    ? publicApiError("We couldn't update that memory.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("We couldn't find that memory, or the correction is empty.", "PAL_MEMORY_NOT_FOUND", 404);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const limiterKey = `pub-pal-memories:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const ownerId = await callerUserId(request);
  if (!ownerId) return unauthenticated();
  // The body is optional: the Pal page deletes with none, and a forget card names the value it expects.
  const body: unknown = await request.json().catch(() => null);
  const { memoryId } = await context.params;
  const result = await deletePalMemoryResult(ownerId, memoryId, palMemoryExpectedValue(body));
  if (result.ok) return jsonNoStore({ deleted: true });
  if (result.error === "conflict") return changedSinceCard();
  return result.error === "error"
    ? publicApiError("We couldn't delete that memory.", "PAL_MEMORY_STORE_UNAVAILABLE", 503, { retryable: true })
    : publicApiError("Pal memory not found.", "PAL_MEMORY_NOT_FOUND", 404);
}
