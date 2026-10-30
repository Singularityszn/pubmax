import "server-only";

import { accountIsAdult, needsAdultSelfAssertion } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { publicApiError } from "@/lib/apiError";
import { contributionAdultRefusal } from "@/lib/contributionGateStatus";
import {
  MESSAGE_ADULT_REFUSAL,
  MESSAGE_BLOCKED_LINE,
  MESSAGE_UNDER_18_REFUSAL,
} from "@/lib/messageSafety";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { profileStore } from "@/lib/profileStore";
import { socialMemoryBlocked } from "@/lib/socialBlockMemory";
import { isMissingTableSchema } from "@/lib/storeBackend";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

/**
 * THE MESSAGE DOORS ASK THE ONE ADULT GATE. Opening a conversation and sending
 * into one are social writes between people, so they ask the same question
 * every contribution door asks (`accountIsAdult`), and the refusal carries the
 * same `status` vocabulary (`lib/contributionGateStatus.ts`), so the shared
 * ContributionGateDialog can offer the one tap.
 *
 * A store we cannot read refuses with a retryable 503 rather than admitting:
 * this is an age check, and an outage is not an answer.
 */
export async function messageAdultRefusal(userId: string): Promise<Response | null> {
  let refusal: ReturnType<typeof contributionAdultRefusal>;
  try {
    const [identity, assertedAt] = await Promise.all([
      privateIdentityStore().read(userId),
      adultSelfAssertionStore().read(userId),
    ]);
    const evidence = {
      dateOfBirth: identity?.dateOfBirth ?? null,
      adultSelfAssertedAt: assertedAt,
    };
    refusal = contributionAdultRefusal({
      isAdult: accountIsAdult(evidence),
      needsSelfAssertion: needsAdultSelfAssertion(evidence),
    });
  } catch {
    return publicApiError(
      "We could not check your account just now. Try again.",
      "IDENTITY_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (!refusal) return null;
  return publicApiError(
    refusal.status === "adult_check_required" ? MESSAGE_ADULT_REFUSAL : MESSAGE_UNDER_18_REFUSAL,
    "ADULT_REQUIRED",
    403,
    { compatibilityFields: { status: refusal.status } },
  );
}

/**
 * Whether ANY two of these profiles have a block between them, in either
 * direction. One read for a pair or a whole group. A block is keyed on the
 * profile, so a handle with no profile row can hold no block.
 */
async function anyBlockAmong(
  profileIds: readonly string[],
): Promise<boolean | "unavailable"> {
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length < 2) return false;
  const memoryAnswer = (): boolean =>
    ids.some((first, index) => ids.slice(index + 1).some((second) => socialMemoryBlocked(first, second)));
  if (!isSupabaseConfigured()) return memoryAnswer();
  try {
    const { data, error } = await requireSupabaseAdmin()
      .from("social_blocks")
      .select("blocker_profile_id")
      .in("blocker_profile_id", ids)
      .in("blocked_profile_id", ids)
      .limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  } catch (error) {
    if (isMissingTableSchema(error, "social_blocks")) return memoryAnswer();
    return "unavailable";
  }
}

/** The handles' profile ids, or null when the profile store could not answer. */
async function profileIdsFor(handles: readonly string[]): Promise<string[] | null> {
  try {
    const profiles = await Promise.all(handles.map((handle) => profileStore().getByHandle(handle)));
    return profiles.flatMap((profile) => (profile ? [profile.id] : []));
  } catch {
    return null;
  }
}

/**
 * The one block refusal for a message door. It never says who blocked whom:
 * the same 403 and the same sentence answer both directions and a group.
 */
export async function messageBlockRefusal(handles: readonly string[]): Promise<Response | null> {
  const ids = await profileIdsFor(handles);
  const blocked = ids === null ? "unavailable" : await anyBlockAmong(ids);
  if (blocked === "unavailable") {
    return publicApiError("Messages are unavailable right now. Try again.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }
  return blocked ? publicApiError(MESSAGE_BLOCKED_LINE, "MESSAGE_BLOCKED", 403) : null;
}
