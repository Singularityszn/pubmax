import "server-only";

import { accountIsAdult, isAdultDateOfBirth, type AccountAdultEvidence } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";
import { publicApiError } from "@/lib/apiError";

const PAL_UNDER_18_REFUSAL =
  "The date of birth on your account is under 18, so a Pub Pal is not open to you.";

/** Read both account answers. Write gates must distinguish a failed read. */
export async function accountAdultEvidence(
  userId: string,
  options?: { strict?: boolean },
): Promise<AccountAdultEvidence> {
  const [privateIdentity, adultSelfAssertedAt] = await Promise.all([
    privateIdentityStore().read(userId),
    adultSelfAssertionStore().read(userId, options),
  ]);
  return { dateOfBirth: privateIdentity?.dateOfBirth ?? null, adultSelfAssertedAt };
}

/**
 * Has this account ALREADY answered the age question as an adult? A stored
 * date of birth decides in both directions and, only where there is none, the
 * recorded one tap does (`accountIsAdult`, the one adult gate). A surface that
 * would ask again ("we ask once") reads this first and skips its own question.
 *
 * This helper uses the assertion store's default read policy. Rejected reads
 * return false. Price write gates use accountAdultEvidence with strict reads
 * instead, so a schema failure cannot become an absent durable assertion.
 */
export async function accountAdultOnFile(userId: string): Promise<boolean> {
  try {
    return accountIsAdult(await accountAdultEvidence(userId));
  } catch {
    return false;
  }
}

/**
 * Did this account tell us a date of birth under 18? An account with no stored
 * date is not refused here. A failed read throws, so a gate fails closed.
 */
async function accountDateOfBirthIsMinor(userId: string): Promise<boolean> {
  const dateOfBirth = (await privateIdentityStore().read(userId))?.dateOfBirth?.trim() ?? "";
  return dateOfBirth !== "" && !isAdultDateOfBirth(dateOfBirth);
}

/**
 * True when the stored date of birth is under 18 or cannot be read.
 * Voice offers must require false. Pal creation and voice enforce the same
 * stored-date rule through palUnder18Refusal.
 */
export async function accountUnder18ForPal(userId: string): Promise<boolean> {
  try {
    return await accountDateOfBirthIsMinor(userId);
  } catch {
    return true;
  }
}

/**
 * The Pal door for an account whose stored date of birth says under 18. Pal
 * creation and voice both ask it, so neither trusts the body's 18+ tick alone.
 */
export async function palUnder18Refusal(userId: string): Promise<Response | null> {
  try {
    if (!await accountDateOfBirthIsMinor(userId)) return null;
  } catch {
    return publicApiError("Pub Pal is temporarily unavailable.", "PUB_PAL_STORE_UNAVAILABLE", 503, { retryable: true });
  }
  return publicApiError(PAL_UNDER_18_REFUSAL, "PUB_PAL_UNDER_18", 403);
}
