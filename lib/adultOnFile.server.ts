import "server-only";

import { accountIsAdult } from "@/lib/adultGate";
import { adultSelfAssertionStore } from "@/lib/adultSelfAssertionStore";
import { privateIdentityStore } from "@/lib/privateIdentityStore";

/**
 * Has this account ALREADY answered the age question as an adult? A stored
 * date of birth decides in both directions and, only where there is none, the
 * recorded one tap does (`accountIsAdult`, the one adult gate). A surface that
 * would ask again ("we ask once") reads this first and skips its own question.
 *
 * It answers false on any trouble reading either store. That is the safe half
 * here: the person is asked, which costs a tap, and nothing is assumed about an
 * account the stores could not speak for.
 */
export async function accountAdultOnFile(userId: string): Promise<boolean> {
  try {
    const [privateIdentity, adultSelfAssertedAt] = await Promise.all([
      privateIdentityStore().read(userId),
      adultSelfAssertionStore().read(userId),
    ]);
    return accountIsAdult({
      dateOfBirth: privateIdentity?.dateOfBirth ?? null,
      adultSelfAssertedAt,
    });
  } catch {
    return false;
  }
}
