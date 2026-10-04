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
 * `docs/VOICE.md` forbids. A kind this build does not hold lands on the NEUTRAL
 * entry rather than on nothing: a heading that reads "undefined" is not copy.
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
  if (kind === undefined) return KIND_LABELS.pub;
  return KIND_LABELS[kind] ?? KIND_LABELS.other;
}

export function venueKindNoun(kind: VenueKind | undefined): string {
  if (kind === undefined) return KIND_NOUNS.pub;
  return KIND_NOUNS[kind] ?? KIND_NOUNS.other;
}

/**
 * The map's kind filter offers the CURATED kinds only. A club keeps its own
 * label but shows and hides with the bars, because it is somewhere to drink and
 * has no chip of its own. A kind that arrived with the UK-wide OSM venue pack
 * answers null, so `filterVenuesByKind` leaves it out of a curated map view
 * rather than showing it under a toggle nobody can reach. Giving those kinds
 * their own surface is a separate wave.
 */
function curatedVenueKind(
  kind: VenueKind | undefined,
): CuratedVenueKind | null {
  if (kind === "bar" || kind === "food" || kind === "restaurant") return kind;
  if (kind === "club") return "bar";
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

/**
 * The venue kinds the map's own filter offers, in the order it draws them.
 *
 * The desktop chips live behind one Filters control, so the badge on the closed
 * control and the chips inside it must count the SAME set: a badge that counted
 * a kind the open panel never offers would say a filter is on over a control
 * nobody can reach. `MAP_EXPERIENCE_LENS` narrows the offer, so the rule takes
 * the lens rather than assuming all four.
 */
const CURATED_VENUE_KIND_ORDER: readonly CuratedVenueKind[] = [
  "pub",
  "bar",
  "food",
  "restaurant",
];

export function offeredVenueKinds(
  experienceLens: string,
): readonly CuratedVenueKind[] {
  return experienceLens === "food"
    ? (["food", "restaurant"] as const)
    : CURATED_VENUE_KIND_ORDER;
}

/** How many of the offered kinds the reader has switched off. */
export function hiddenVenueKindCount(
  visibility: VenueKindVisibility,
  experienceLens: string,
): number {
  return offeredVenueKinds(experienceLens).filter((kind) => !visibility[kind])
    .length;
}

/**
 * Every offered kind back on. Under a narrowed lens the kinds it does not offer
 * keep the answer they already had, because a reset may only ever change what
 * the reader could see.
 */
export function showAllVenueKinds(
  visibility: VenueKindVisibility,
  experienceLens: string,
): VenueKindVisibility {
  const next = { ...visibility };
  for (const kind of offeredVenueKinds(experienceLens)) next[kind] = true;
  return next;
}

/**
 * How many refinements the desktop Filters control is holding.
 *
 * It counted hidden venue kinds alone, which was the whole of what the panel
 * offered. The panel now also holds the experience lens and the fare-zone
 * picker (the two other controls that narrow the same pin set, moved in off the
 * toolbar row on 7 Sep 2026), and a badge that counted one of three would say
 * the map is unfiltered while two filters are on.
 */
export function mapFilterRefinementCount(parts: {
  hiddenKinds: number;
  lensNarrowed: boolean;
  zoneNarrowed: boolean;
}): number {
  return (
    parts.hiddenKinds + (parts.lensNarrowed ? 1 : 0) + (parts.zoneNarrowed ? 1 : 0)
  );
}

/** The word on the closed control. */
export const VENUE_KIND_FILTER_WORD = "Filters";

/**
 * What the closed control reads. The count rides the word, so no filter the map
 * is applying is invisible. Under 900px the word itself is dropped and the
 * count stays, because the toolbar row is a budget there and the search field
 * is what a longer label costs; the accessible name below carries the whole
 * sentence at every width.
 */
export function venueKindFilterLabel(hiddenCount: number): string {
  return hiddenCount > 0
    ? `${VENUE_KIND_FILTER_WORD} · ${hiddenCount}`
    : VENUE_KIND_FILTER_WORD;
}

/** What a reader hears. The visible label is a count; this one says what it counts. */
export function venueKindFilterAriaLabel(refinementCount: number): string {
  if (refinementCount === 0) return "Filters: venue types, view and zone";
  return `Filters: venue types, view and zone, ${refinementCount} ${
    refinementCount === 1 ? "filter" : "filters"
  } on`;
}
