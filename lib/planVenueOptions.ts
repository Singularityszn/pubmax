import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { isVenueKind, type VenueKind } from "@/lib/venues";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { toZoneId } from "@/lib/zones";

export type PlanVenueOption = {
  id: string;
  name: string;
  address?: string;
  borough?: string;
  lat?: number;
  lng?: number;
  /** Nearest-station fare zone, for the stop card's zone estimate. */
  zone?: number;
  hasRecordedPrice?: boolean;
};

export function planVenueOptions(value: unknown): PlanVenueOption[] {
  const rows = rowsFromSlimPayload(value);
  if (!rows) return [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const kind: VenueKind | undefined | null =
      row.kind === undefined ? undefined : isVenueKind(row.kind) ? row.kind : null;
    // A plan may be shared with people who have never met, so its pub picker
    // offers only pubs the public can walk into (lib/venueKindFilters.ts).
    if (!id || !name || kind === null || !isPublicRankablePub({ kind, name })) return [];
    const address =
      typeof row.address === "string" ? row.address.trim() : "";
    const borough =
      typeof row.borough === "string" ? row.borough.trim() : "";
    const coordinates = typeof row.lat === "number" && typeof row.lng === "number"
      && Number.isFinite(row.lat) && Number.isFinite(row.lng)
      && Math.abs(row.lat) <= 90 && Math.abs(row.lng) <= 180
        ? { lat: row.lat, lng: row.lng }
        : {};
    const zone = toZoneId(row.zone);
    const price = row.cheapestPrice;
    const hasRecordedPrice = typeof price === "number" && Number.isFinite(price) && price > 0
      ? true : typeof row.hasRecordedPrice === "boolean" ? row.hasRecordedPrice : undefined;
    return [{
      id, name, ...(address ? { address } : {}), ...(borough ? { borough } : {}), ...coordinates,
      ...(zone !== null ? { zone } : {}),
      ...(hasRecordedPrice !== undefined ? { hasRecordedPrice } : {}),
    }];
  });
}
