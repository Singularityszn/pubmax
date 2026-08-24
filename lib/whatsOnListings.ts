// Pure merge for the What's-On serving spine: durable official-API rows win
// when they are fresher; the bundled files remain the fallback. Expired rows
// never leave this function, so a store that still holds last week's gig
// cannot reach a Tonight card.

import { filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import { mergeWhatsOn } from "@/lib/whatsOnStore";

export function preferDurableWhatsOn(
  durable: WhatsOnRow[],
  bundled: WhatsOnRow[],
  now: number,
): WhatsOnRow[] {
  return filterNotPast(mergeWhatsOn(bundled, durable), now);
}
