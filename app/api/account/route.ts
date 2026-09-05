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
// The write itself is one row (`lib/accountDeletion.server.ts`). Migration
// `0078`'s trigger, extended by `0096`, `0097`, `0098` and `0102`, owns
// everything downstream.

import { accountIsDeleted } from "@/lib/accountDeletion";
import { deleteOwnAccount } from "@/lib/accountDeletion.server";
import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

assertServerEnv();

export async function DELETE(request: Request): Promise<Response> {
  // ONE bearer verification for the whole request; the gate below takes it
  // rather than asking Supabase a second time.
  const caller = await callerUserId(request);
  if (!caller) {
    return publicApiError("Sign in to delete your account.", "UNAUTHENTICATED", 401);
  }

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

  // `already-gone` answers exactly like `deleted`: a second DELETE from a
  // browser that never saw the first answer must not report a live account.
  return jsonNoStore({ deleted: true }, { status: 200 });
}
