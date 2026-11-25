import "server-only";

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import type { mutatePlanShortlist } from "@/lib/planShortlistStore";
import { clientIp, hashIp } from "@/lib/supabase";

export async function shortlistWriteGate(request: Request, operation: "vote" | "confirm" | "create"): Promise<Response | null> {
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;
  const key = `plan-shortlist-${operation}:${hashIp(clientIp(request))}`;
  return await isLimited(key, key, 30, undefined, { failClosed: true })
    ? publicApiError("Too many requests. Try again shortly.", "RATE_LIMITED", 429, { retryable: true })
    : null;
}

export function shortlistMutationResponse(result: Awaited<ReturnType<typeof mutatePlanShortlist>>): Response {
  switch (result.status) {
    case "saved":
    case "unchanged":
      return jsonNoStore({ shortlist: result.view, changed: result.status === "saved" });
    case "invalid":
      return publicApiError("Choose a shortlisted pub and a future time.", "INVALID_REQUEST", 400);
    case "closed":
      return publicApiError("The organiser has already confirmed the pub and time.", "CONFLICT", 409);
    case "expired":
      return publicApiError("This invite link has expired.", "GONE", 410);
    case "missing":
      return publicApiError("This shortlist is unavailable.", "NOT_FOUND", 404);
    case "forbidden":
      return publicApiError("Only the organiser can confirm the pub and time.", "FORBIDDEN", 403);
    case "full":
      return publicApiError("This shortlist has reached its vote limit.", "CONFLICT", 409);
    case "unavailable":
      return publicApiError("Could not save the shortlist. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}
