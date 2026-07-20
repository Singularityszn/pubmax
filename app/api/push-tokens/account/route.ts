// Account join for an existing anonymous push registration.
//
// The account id is derived exclusively from a verified Supabase bearer JWT;
// client-supplied user/account ids are ignored. A linked profile is also
// required, so signing in without completing the account-claim seam cannot
// silently create a person-targetable registration.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerAuthSessionIdentity } from "@/lib/authServer";
import { profileStore } from "@/lib/profileStore";
import { validatePushIdentityMutation } from "@/lib/pushInstallation";
import { pushTokenStore, validatePushToken } from "@/lib/pushTokenStore";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

async function verifiedClaimedAccount(request: Request): Promise<
  | { ok: true; userId: string; sessionId: string }
  | { ok: false; response: Response }
> {
  const identity = await callerAuthSessionIdentity(request);
  if (!identity) {
    return {
      ok: false,
      response: publicApiError("Sign in to link this notification registration.", "PUSH_ACCOUNT_AUTH_REQUIRED", 401),
    };
  }
  try {
    const profile = await profileStore().getByUserId(identity.id);
    if (!profile) {
      return {
        ok: false,
        response: publicApiError("Claim your account before linking personal notifications.", "PUSH_ACCOUNT_CLAIM_REQUIRED", 403),
      };
    }
  } catch {
    return {
      ok: false,
      response: publicApiError("Account identity is temporarily unavailable.", "PUSH_ACCOUNT_IDENTITY_UNAVAILABLE", 503, { retryable: true }),
    };
  }
  return { ok: true, userId: identity.id, sessionId: identity.sessionId };
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const authority = await verifiedClaimedAccount(request);
  if (!authority.ok) return authority.response;
  const body = await bodyOf(request);
  if (!body) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  const validation = validatePushToken(body);
  if (!validation.ok) return publicApiError(validation.error, "INVALID_REQUEST", 400);
  const mutation = validatePushIdentityMutation(body);
  if (!mutation.ok) return publicApiError(mutation.error, "INVALID_REQUEST", 400);

  const result = await pushTokenStore().linkAccount(
    validation.input.token,
    authority.userId,
    authority.sessionId,
    mutation.input.installationId,
    mutation.input.mutationVersion,
  );
  if (result === "linked" || result === "replayed") {
    return jsonNoStore({ ok: true, linked: true }, { status: 200 });
  }
  if (result === "error") {
    return publicApiError("Could not link notifications. Try again.", "PUSH_ACCOUNT_LINK_UNAVAILABLE", 503, { retryable: true });
  }
  // Missing and already-owned registrations deliberately share one response:
  // no account can enumerate or steal another account's token.
  return publicApiError("That notification registration cannot be linked.", "PUSH_ACCOUNT_LINK_CONFLICT", 409);
}

export async function DELETE(request: Request): Promise<Response> {
  const authority = await verifiedClaimedAccount(request);
  if (!authority.ok) return authority.response;
  const body = await bodyOf(request);
  if (!body) return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  const mutation = validatePushIdentityMutation(body);
  if (!mutation.ok) return publicApiError(mutation.error, "INVALID_REQUEST", 400);

  let authoritativeMutationVersion = mutation.input.mutationVersion;
  try {
    if (body.all === true) {
      authoritativeMutationVersion = await pushTokenStore().unlinkAllForAccount(
        authority.userId,
        authority.sessionId,
        mutation.input.installationId,
        mutation.input.mutationVersion,
      );
    } else if (body.installationOnly === true) {
      authoritativeMutationVersion = await pushTokenStore().unlinkInstallationForAccount(
        mutation.input.installationId,
        authority.userId,
        authority.sessionId,
        mutation.input.mutationVersion,
      );
    } else {
      const validation = validatePushToken(body);
      if (!validation.ok) return publicApiError(validation.error, "INVALID_REQUEST", 400);
      authoritativeMutationVersion = await pushTokenStore().unlinkAccount(
        validation.input.token,
        authority.userId,
        authority.sessionId,
        mutation.input.installationId,
        mutation.input.mutationVersion,
      );
    }
  } catch {
    return publicApiError("Could not unlink notifications. Try again.", "PUSH_ACCOUNT_UNLINK_UNAVAILABLE", 503, { retryable: true });
  }
  // Always the same idempotent response, including absent/wrong-owner tokens.
  return jsonNoStore({
    ok: true,
    linked: false,
    mutationVersion: authoritativeMutationVersion,
  }, { status: 200 });
}
