import "server-only";

// The ONE writer that deletes a PUBMAXX account.
//
// The whole operation is `auth.admin.deleteUser(userId)`. Migration `0078`'s
// BEFORE DELETE trigger on `auth.users`, extended by `0096`, `0097`, `0098` and
// `0102`, does everything downstream: the profile tombstone, the owned image
// rows and their bytes, the wall photos, the cover rotation and the message
// attachments. Do NOT add a second cleanup pass here; a hand-written one would
// drift away from the trigger and leave two answers about what a deletion means.
//
// The caller id is derived from the caller's own verified bearer at the route,
// never from a request field, so this function can only ever delete the account
// that asked. It takes the id rather than the request for exactly that reason:
// there is no argument here a caller could aim somewhere else.

import { type AccountDeletionOutcome } from "@/lib/accountDeletion";
import { log } from "@/lib/log";
import { requireSupabaseAdmin } from "@/lib/supabase";

/**
 * Codes and messages GoTrue answers with when the account is already gone.
 *
 * A second DELETE is not a failure. The browser that sent the first one may
 * never have seen its answer, and telling somebody their deleted account is
 * still here is worse than saying nothing.
 */
const ALREADY_GONE_CODES = new Set(["user_not_found", "not_found"]);

function isAlreadyGone(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 404) return true;
  if (typeof candidate.code === "string" && ALREADY_GONE_CODES.has(candidate.code)) {
    return true;
  }
  return (
    typeof candidate.message === "string"
    && /user not found/i.test(candidate.message)
  );
}

function failureReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "unknown";
}

/**
 * Delete the account behind `userId` and let the `0078` trigger do the rest.
 *
 * THREE-WAY on purpose, and the third answer is the point: a delete we could not
 * RUN is `unavailable` and is reported as a failure the reader may retry, while
 * an account that is already gone is a success. Merging them would either tell a
 * person their account survived an outage it did not, or tell them a live
 * account is deleted when nothing was written.
 */
export async function deleteOwnAccount(
  userId: string,
): Promise<AccountDeletionOutcome> {
  const id = userId.trim();
  if (!id) return "unavailable";

  try {
    const { error } = await requireSupabaseAdmin().auth.admin.deleteUser(id);
    if (!error) return "deleted";
    if (isAlreadyGone(error)) return "already-gone";
    log("error", "account.delete_failed", { reason: failureReason(error) });
    return "unavailable";
  } catch (err) {
    if (isAlreadyGone(err)) return "already-gone";
    log("error", "account.delete_failed", { reason: failureReason(err) });
    return "unavailable";
  }
}
