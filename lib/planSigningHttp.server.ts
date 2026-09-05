import "server-only";

import { publicApiError } from "@/lib/apiError";
import { isPlanGroundingProofUnmintableError } from "@/lib/planGrounding.server";
import { isTrustedSigningKeyUnavailableError, trustedSigningKey } from "@/lib/trustedSigningKey.server";

export function planSigningUnavailableResponse(error: unknown): Response | null {
  if (!isTrustedSigningKeyUnavailableError(error)) return null;
  return publicApiError(
    "Plan saving is temporarily unavailable. Try again.",
    "PLAN_SIGNING_UNAVAILABLE",
    503,
    { retryable: true, headers: { "Retry-After": "60" } },
  );
}

/** Fail before a durable mutation if its required verified response cannot be signed. */
export function planSigningPreflightResponse(): Response | null {
  try {
    trustedSigningKey();
    return null;
  } catch (error) {
    const unavailable = planSigningUnavailableResponse(error);
    if (unavailable) return unavailable;
    throw error;
  }
}

/**
 * A proof the server could not mint over the set it just built. It is a
 * REFUSAL about this request rather than an outage, so it takes the same 422
 * the generate route's own scarcity check answers with, never a 500 (F-13):
 * a 500 is the one answer a planner surface cannot word.
 */
export function planGroundingUnmintableResponse(
  error: unknown,
  details: Record<string, unknown>,
): Response | null {
  if (!isPlanGroundingProofUnmintableError(error)) return null;
  return publicApiError(
    "That route could not be verified. Give it another go.",
    "GROUNDED_VENUES_INSUFFICIENT",
    422,
    { details },
  );
}
