// Pure merge for the What's-On serving spine: durable official-API rows win on
// identity, and the bundled files fill gaps. Expired rows never leave this
// function, so a store that still holds last week's gig cannot reach a Tonight
// card.

import { dedupeKey, dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";

export function preferDurableWhatsOn(
  durable: WhatsOnRow[],
  bundled: WhatsOnRow[],
  now: number,
): WhatsOnRow[] {
  const durableRows = dedupeRows(filterNotPast(durable, now));
  const durableKeys = new Set(durableRows.map(dedupeKey));
  const bundledRows = dedupeRows(filterNotPast(bundled, now)).filter(
    (row) => !durableKeys.has(dedupeKey(row)),
  );
  return [...durableRows, ...bundledRows];
}
