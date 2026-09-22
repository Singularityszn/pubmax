// Authenticated account-boundary cleanup for an installed web subscription.
// The token is delivery material, not identity. A verified bearer authorizes
// account-boundary cleanup; exact token equality limits which delivery endpoint
// and historical preference bindings can be retired.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";
import { stepOutNudgeStore } from "@/lib/stepOutNudgeStore";

assertServerEnv();

export async function DELETE(request: Request): Promise<Response> {
  const verification = await verifyCallerAuth(request);
  if (verification.status === "unavailable") {
    return publicApiError(
      "We could not check your sign-in. Try again.",
      "AUTH_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (verification.status !== "verified") {
    return publicApiError(
      "Sign in to remove account notifications.",
      "UNAUTHENTICATED",
      401,
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const validation = validatePushToken({ token: body.token, platform: "web" });
  if (!validation.ok) {
    return publicApiError(validation.error, "INVALID_REQUEST", 400);
  }

  try {
    await Promise.all([
      stepOutNudgeStore().detachSubscriptionToken(validation.input.token),
      pushTokenStore().delete(validation.input.token),
    ]);
  } catch {
    return publicApiError(
      "Could not remove account notifications. Try again.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  return jsonNoStore({ ok: true }, { status: 200 });
}
