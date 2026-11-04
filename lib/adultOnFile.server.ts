import "server-only";

import { accountIsAdult, type AccountAdultEvidence } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";

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
