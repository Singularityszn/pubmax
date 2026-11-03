import { isPubVenueKind } from "@/lib/venueKindFilters";
import type { VenueKind } from "@/lib/venues";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";

export type BoroughBingoSquare =
  | { kind: "free"; borough: string }
  | { kind: "empty"; borough: string }
  | { kind: "visited"; borough: string; venueId: string; venueName: string };

type Been = { venueId: string; venueName: string };
type Venue = { id: string; borough: string; kind?: VenueKind };

export function boroughBingoSquares(been: readonly Been[], venues: readonly Venue[]): BoroughBingoSquare[] {
  const byId = new Map<string, string | null>();
  for (const venue of venues) {
    byId.set(venue.id, byId.has(venue.id) || !isPubVenueKind(venue.kind) ? null : venue.borough);
  }
  const allowed = new Set(LONDON_BOROUGH_NAMES);
  const byBorough = new Map<string, Been>();
  for (const pub of been) {
    const borough = byId.get(pub.venueId);
    if (borough && allowed.has(borough) && !byBorough.has(borough)) byBorough.set(borough, pub);
  }
  return LONDON_BOROUGH_NAMES.map((borough) => {
    if (borough === "City of London") return { kind: "free", borough };
    const pub = byBorough.get(borough);
    return pub ? { kind: "visited", borough, venueId: pub.venueId, venueName: pub.venueName } : { kind: "empty", borough };
  });
}
