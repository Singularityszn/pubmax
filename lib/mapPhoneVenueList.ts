import { buildMapVenueListModel, type MapVenueListModel, type MapVenueListSortMode } from "@/lib/mapVenueList";
import { mapVenueListPriceEvidence } from "@/lib/mapVenueListPrice";

export function buildPhoneMapVenueListModel(...input: Parameters<typeof buildMapVenueListModel>): MapVenueListModel {
  const model = buildMapVenueListModel(...input);
  const [venues, , , lensPrices = null, , , , signals = null, zoneIndex = null] = input;
  const byId = new Map(venues.map((venue) => [venue.id, venue]));
  return {
    ...model,
    rows: model.rows.map((row) => ({
      ...row,
      priceEvidence: mapVenueListPriceEvidence(byId.get(row.id)!, signals?.get(row.id), lensPrices, zoneIndex),
    })),
  };
}


export function phoneMapVenueListRows(rows: MapVenueListModel["rows"], sortMode: MapVenueListSortMode): MapVenueListModel["rows"] {
  if (sortMode === "nearest") return rows;
  return [...rows].sort((a, b) => {
    const priceA = a.priceEvidence?.priceGbp ?? Infinity;
    const priceB = b.priceEvidence?.priceGbp ?? Infinity;
    if (priceA !== priceB) return priceA - priceB;
    return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
