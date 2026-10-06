// Delete your own PUBMAXX account.
//
// App Store Review Guideline 5.1.1(v) and Play's 2024 account-deletion policy
// both require this door INSIDE the app for any product that offers account
// creation, and `docs/STORE_READINESS.md` already promises both stores it is
// here. `/account/delete` is the public page the Play Console field points at.
//
// THE TARGET IS THE TOKEN, never a request field. There is no handle, id or
// email in the body that could aim this somewhere else: the account deleted is
// the one the caller's own verified bearer names, so a request can only ever
// delete the account that sent it. The `resolveMessageHandle` /
// `gateHandleAction` seam runs on top of that as the ordinary ownership check
// every private write in this app goes through; a caller with no claimed handle
// keeps the door, because a handle is not what makes an account theirs.
//
// The write is `lib/accountDeletion.server.ts`: the account's own Storage
// objects through the Storage API first, then the one auth row. Migration
// `0078`'s trigger, as restated by `0145`, owns everything downstream.
//
// A DELETE IS IDEMPOTENT, so the door must still answer AFTER the auth row it
// names has gone. The bearer is therefore verified against the project JWKS
// rather than by asking the auth server for the account; the reasoning is on
// that call below, and it is what makes the documented 410 `already-gone`
// reachable at all.

import { accountIsDeleted } from "@/lib/accountDeletion";
import { deleteOwnAccount } from "@/lib/accountDeletion.server";
import { authUnavailableError, publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { verifyCallerAuth } from "@/lib/authServer";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

assertServerEnv();

export async function DELETE(request: Request): Promise<Response> {
  // ONE bearer verification for the whole request; the gate below takes it
  // rather than asking Supabase a second time.
  //
  // IT IS THE TOKEN'S OWN CLAIMS, NEVER THE ACCOUNT ROW, AND THAT IS WHAT MAKES
  // THE SECOND DELETE ANSWERABLE. `callerUserId` asks GoTrue for the account, so
  // the moment the first delete removes the auth row every later request with
  // that bearer reads as `user_not_found`, and the repeat answered 401
  // `UNAUTHENTICATED` - the one thing it is not, because the caller signed the
  // request and we know exactly whose account it names. Verification scout
  // verify-preview-4 measured that: `DELETE 200 at 21:02:17, DELETE 401 at
  // 21:02:31`, with the documented 410 `already-gone` unreachable behind it.
  // `{ localOnly: true }` checks the signature and the expiry against the
  // project JWKS and takes `sub` from the verified claims, so a deleted account
  // is still NAMED by its own unexpired token and the request reaches the
  // idempotent answer it was promised. Nothing here trusts a claim it did not
  // verify, and the target is still the token rather than a field.
  //
  // THIS DOOR IS THE ONLY ONE THAT MAY ASK FOR IT. A locally verified token
  // says nothing about whether the account still exists, which is exactly the
  // property a second DELETE needs and exactly the property every other gate
  // must not have (review finding F-3): `verifyCallerAuth` asks GoTrue by
  // default, so a deleted account stops passing the contribution gate, the
  // Social gate and the plan-seat claim the moment its auth row is gone.
  // Nothing is lost here by the weaker check, because the only thing this
  // request can do to a live account is delete it at its own asking.
  //
  // THREE-WAY, because a verification we could not RUN is a fact about us: it
  // answers 503 rather than telling somebody who is signed in that they are not.
  const verification = await verifyCallerAuth(request, { localOnly: true });
  if (verification.status === "unavailable") {
    return authUnavailableError();
  }
  if (verification.status !== "verified") {
    return publicApiError("Sign in to delete your account.", "UNAUTHENTICATED", 401);
  }
  const caller = verification.identity.id;

  // Per-account plus hashed-IP budget, like every other mutating route.
  const key = `account-delete:${caller}:${hashIp(clientIp(request))}`;
  if (await isLimited(caller, key)) {
    return publicApiError(
      "Too many account requests, slow down.",
      "RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  // The account's own linked handle, derived from the verified bearer. A body
  // handle is never read here, so there is nothing to spoof.
  const handle = await resolveMessageHandle(request, null, caller);
  if (handle) {
    const ownership = await gateHandleAction(request, handle, caller);
    if (!ownership.allowed) {
      return publicApiErrorFromStatus(ownership.error, ownership.status);
    }
  }

  // A verified bearer means Supabase Auth answered, so an unconfigured store
  // here is a misconfiguration rather than the keyless dev path. Say so instead
  // of throwing out of `requireSupabaseAdmin`.
  if (!isSupabaseConfigured()) {
    return publicApiError(
      "Account deletion is not configured.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  const outcome = await deleteOwnAccount(caller);
  if (!accountIsDeleted(outcome)) {
    return publicApiError(
      "Your account could not be deleted.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  // A second DELETE is 410 Gone, and it still says `deleted: true`: a browser
  // that never saw the first answer must not be told the account it just
  // deleted is still here, and a caller reading the status alone must not read
  // a repeat as a fresh deletion. Nothing was written this time.
  if (outcome === "already-gone") {
    return publicApiError(
      "Your account is already deleted.",
      "ACCOUNT_GONE",
      410,
      { compatibilityFields: { deleted: true } },
    );
  }

  return jsonNoStore({ deleted: true }, { status: 200 });
}
