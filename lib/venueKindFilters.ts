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

/**
 * The word a surface prints for a kind. Every kind names itself: falling
 * through to "Pub" would print the wrong noun over a library the moment the
 * vocabulary widened, and a wrong noun beside a figure is exactly what
 * `docs/VOICE.md` forbids.
 */
const KIND_LABELS: Record<VenueKind, string> = {
  pub: "Pub",
  bar: "Bar",
  club: "Club",
  food: "Late food",
  restaurant: "Restaurant",
  cafe: "Cafe",
  coworking: "Coworking space",
  library: "Library",
  hotel_lounge: "Hotel bar",
  other: "Venue",
};

const KIND_NOUNS: Record<VenueKind, string> = {
  pub: "pub",
  bar: "bar",
  club: "club",
  food: "late-food venue",
  restaurant: "restaurant",
  cafe: "cafe",
  coworking: "coworking space",
  library: "library",
  hotel_lounge: "hotel bar",
  other: "venue",
};

export function venueKindLabel(kind: VenueKind | undefined): string {
  return kind === undefined ? KIND_LABELS.pub : KIND_LABELS[kind];
}

export function venueKindNoun(kind: VenueKind | undefined): string {
  return kind === undefined ? KIND_NOUNS.pub : KIND_NOUNS[kind];
}

/**
 * The map's kind filter offers the CURATED kinds only. A kind that arrived with
 * the UK-wide OSM venue pack answers null, so `filterVenuesByKind` leaves it out
 * of a curated map view rather than showing it under a toggle nobody can reach.
 * Giving those kinds their own surface is a separate wave.
 */
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
