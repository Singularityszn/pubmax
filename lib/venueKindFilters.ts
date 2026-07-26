import type { Venue, VenueKind } from "@/lib/venues";

export type WaveOneVenueKind = "pub" | "bar" | "food";
export type VenueKindVisibility = Record<WaveOneVenueKind, boolean>;

export function defaultVenueKindVisibility(): VenueKindVisibility {
  return { pub: true, bar: true, food: true };
}

export function toggleVenueKind(
  current: VenueKindVisibility,
  kind: WaveOneVenueKind,
): VenueKindVisibility {
  return { ...current, [kind]: !current[kind] };
}

export function isPubVenueKind(kind: VenueKind | undefined): boolean {
  return kind === undefined || kind === "pub";
}

export function isPubVenue(venue: Venue): boolean {
  return isPubVenueKind(venue.kind);
}

function waveOneKind(kind: VenueKind | undefined): WaveOneVenueKind | null {
  if (kind === "bar" || kind === "food") return kind;
  if (kind === undefined || kind === "pub") return "pub";
  return null;
}

export function filterVenuesByKind(
  venues: Venue[],
  visibility: VenueKindVisibility,
): Venue[] {
  return venues.filter((venue) => {
    const kind = waveOneKind(venue.kind);
    return kind !== null && visibility[kind];
  });
}
