// Pure merge for the What's-On serving spine: durable official-API rows win on
// identity, and the bundled files fill gaps. Expired rows never leave this
// function, so a store that still holds last week's gig cannot reach a Tonight
// card.

import { dedupeKey, dedupeRows, filterNotPast, type WhatsOnRow } from "@/lib/whatsOn";
import { skiddleLaneFenced } from "@/lib/whatson/eventNormalise.mjs";
import { eventIdentityKey } from "@/lib/whatsOnRowShape.mjs";
import { normalizeVenueIdentityName } from "@/scripts/lib/venueCanonicalization.mjs";

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

type BundledVenueEvidence = {
  venueId: string;
  placeName: string;
};

function venueEvidenceAgrees(row: WhatsOnRow, evidence: BundledVenueEvidence): boolean {
  const currentName = normalizeVenueIdentityName(row.placeName);
  const historicalName = normalizeVenueIdentityName(evidence.placeName);
  return Boolean(currentName) && currentName === historicalName;
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
  const bundledVenueByIdentity = new Map<string, BundledVenueEvidence | null>();
  for (const row of bundled.filter(isServableWhatsOnRow)) {
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    if (!venueId) continue;
    const evidence = { venueId, placeName: row.placeName };
    for (const identity of venueIdentityKeys(row)) {
      if (!bundledVenueByIdentity.has(identity)) {
        bundledVenueByIdentity.set(identity, evidence);
        continue;
      }
      const existing = bundledVenueByIdentity.get(identity);
      if (
        existing &&
        (existing.venueId !== evidence.venueId ||
          normalizeVenueIdentityName(existing.placeName) !==
            normalizeVenueIdentityName(evidence.placeName))
      ) {
        bundledVenueByIdentity.set(identity, null);
      }
    }
  }
  const enrichedDurableRows = durableRows.map((row) => {
    if (typeof row.venueId === "string" && row.venueId.trim()) return row;
    const evidence = venueIdentityKeys(row)
      .map((identity) => bundledVenueByIdentity.get(identity))
      .find((candidate) => candidate !== undefined && candidate !== null && venueEvidenceAgrees(row, candidate));
    return evidence ? { ...row, venueId: evidence.venueId } : row;
  });
  return [
    ...enrichedDurableRows,
    ...bundledRows.filter((row) => !durableKeys.has(dedupeKey(row))),
  ];
}
