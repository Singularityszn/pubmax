import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";

export type PlanVenueOption = {
  id: string;
  name: string;
  address?: string;
};

const VENUE_KINDS = new Set<VenueKind>([
  "pub",
  "bar",
  "club",
  "food",
  "restaurant",
]);

export function planVenueOptions(value: unknown): PlanVenueOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const kind =
      row.kind === undefined ||
      (typeof row.kind === "string" && VENUE_KINDS.has(row.kind as VenueKind))
        ? (row.kind as VenueKind | undefined)
        : null;
    if (!id || !name || kind === null || !isPubVenueKind(kind)) return [];
    const address =
      typeof row.address === "string" ? row.address.trim() : "";
    return [{ id, name, ...(address ? { address } : {}) }];
  });
}
