// Pure merge for the What's-On serving spine: durable official-API rows win on
// identity, and the bundled files fill gaps. Expired rows never leave this
// function, so a store that still holds last week's gig cannot reach a Tonight
// card.

import { dedupeKey, dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import { skiddleLaneFenced } from "@/lib/whatson/eventNormalise.mjs";
import { eventIdentityKey } from "@/lib/whatsOnRowShape.mjs";

function providerKey(label: string): string {
  return label.trim().toLocaleLowerCase("en-GB");
}

function stableProviderRowKey(row: WhatsOnRow): string | null {
  const id = row.id.trim();
  const provider = providerKey(row.source.label);
  return id && provider ? `${provider}|${id}` : null;
}

function venueIdentityKeys(row: WhatsOnRow): string[] {
  const eventIdentity = eventIdentityKey(row);
  const stableProviderRow = stableProviderRowKey(row);
  return [
    ...(eventIdentity ? [`event:${eventIdentity}`] : []),
    ...(stableProviderRow ? [`row:${stableProviderRow}`] : []),
  ];
}

export function isServableWhatsOnRow(row: WhatsOnRow): boolean {
  return !(skiddleLaneFenced() && providerKey(row.source.label) === "skiddle");
}

export function preferDurableWhatsOn(
  durable: WhatsOnRow[],
  bundled: WhatsOnRow[],
  now: number,
): WhatsOnRow[] {
  const durableRows = dedupeRows(filterNotPast(durable, now).filter(isServableWhatsOnRow));
  const durableKeys = new Set(durableRows.map(dedupeKey));
  const bundledRows = dedupeRows(
    filterNotPast(bundled, now).filter(isServableWhatsOnRow),
  );
  const bundledVenueByIdentity = new Map<string, string>();
  for (const row of bundled.filter(isServableWhatsOnRow)) {
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    if (!venueId) continue;
    for (const identity of venueIdentityKeys(row)) {
      if (!bundledVenueByIdentity.has(identity)) {
        bundledVenueByIdentity.set(identity, venueId);
      }
    }
  }
  const enrichedDurableRows = durableRows.map((row) => {
    if (typeof row.venueId === "string" && row.venueId.trim()) return row;
    const venueId = venueIdentityKeys(row)
      .map((identity) => bundledVenueByIdentity.get(identity))
      .find((candidate) => candidate !== undefined);
    return venueId ? { ...row, venueId } : row;
  });
  return [
    ...enrichedDurableRows,
    ...bundledRows.filter((row) => !durableKeys.has(dedupeKey(row))),
  ];
}
