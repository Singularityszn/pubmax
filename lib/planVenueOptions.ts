import { isPubVenueKind } from "@/lib/venueKindFilters";
import { isVenueKind, type VenueKind } from "@/lib/venues";

export type PlanVenueOption = {
  id: string;
  name: string;
  address?: string;
};

export function planVenueOptions(value: unknown): PlanVenueOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const kind: VenueKind | undefined | null =
      row.kind === undefined ? undefined : isVenueKind(row.kind) ? row.kind : null;
    if (!id || !name || kind === null || !isPubVenueKind(kind)) return [];
    const address =
      typeof row.address === "string" ? row.address.trim() : "";
    return [{ id, name, ...(address ? { address } : {}) }];
  });
}
