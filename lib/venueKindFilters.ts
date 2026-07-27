import type { Venue, VenueKind } from "@/lib/venues";

export type CuratedVenueKind = "pub" | "bar" | "food" | "restaurant";
export type VenueKindVisibility = Record<CuratedVenueKind, boolean>;

export function defaultVenueKindVisibility(): VenueKindVisibility {
  return { pub: true, bar: true, food: true, restaurant: true };
}

export function toggleVenueKind(
  current: VenueKindVisibility,
  kind: CuratedVenueKind,
): VenueKindVisibility {
  return { ...current, [kind]: !current[kind] };
}

export function isPubVenueKind(kind: VenueKind | undefined): boolean {
  return kind === undefined || kind === "pub";
}

export function isPubVenue(venue: Venue): boolean {
  return isPubVenueKind(venue.kind);
}

export function hasSavedPubVenue(
  venues: readonly Venue[],
  savedIds: ReadonlySet<string>,
): boolean {
  return venues.some((venue) => isPubVenue(venue) && savedIds.has(venue.id));
}

export function venueKindLabel(kind: VenueKind | undefined): string {
  if (kind === "bar") return "Bar";
  if (kind === "food") return "Late food";
  if (kind === "club") return "Club";
  if (kind === "restaurant") return "Restaurant";
  return "Pub";
}

export function venueKindNoun(kind: VenueKind | undefined): string {
  if (kind === "bar") return "bar";
  if (kind === "food") return "late-food venue";
  if (kind === "club") return "club";
  if (kind === "restaurant") return "restaurant";
  return "pub";
}

function curatedVenueKind(
  kind: VenueKind | undefined,
): CuratedVenueKind | null {
  if (kind === "bar" || kind === "food" || kind === "restaurant") return kind;
  if (kind === undefined || kind === "pub") return "pub";
  return null;
}

export function filterVenuesByKind(
  venues: Venue[],
  visibility: VenueKindVisibility,
): Venue[] {
  return venues.filter((venue) => {
    const kind = curatedVenueKind(venue.kind);
    return kind !== null && visibility[kind];
  });
}
