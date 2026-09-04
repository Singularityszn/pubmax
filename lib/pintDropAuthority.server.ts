import "server-only";

import { hashActor } from "@/lib/supabase";

/**
 * Per-venue pseudonym for one verified PUBMAXX User ID.
 *
 * The key proves independence for Pint Price corroboration without exposing the
 * account id or making the public feed linkable across venues. A submission
 * with no verified actor has no key and stays provisional.
 *
 * ANONYMITY IS DISPLAY, NOT ATTRIBUTION (#1436). A signed-in drinker who posts
 * anonymously is still one known account, so the key is derived exactly as it
 * is for a public drop. Withholding it made an anonymous price unable to
 * corroborate at any age, however many drinkers arrived - a price that could
 * never earn its standing. What anonymity buys is that neither the handle nor
 * this key rides the public DTO (`toDTO` in lib/pintDropsStore.ts): the key is
 * per-venue, so publishing it beside the same account's public drop at that pub
 * would name the anonymous drinker.
 */
export function pintDropAuthorityKey(
  venueId: string,
  verifiedActor: string | null | undefined,
): string | undefined {
  const venue = venueId.trim();
  const actor = verifiedActor?.trim();
  if (!venue || !actor) return undefined;
  return hashActor(`pint-drop-authority:${venue}:${actor}`);
}
