import type { Venue, VenueKind } from "@/lib/venues";

export type CuratedVenueKind = "pub" | "bar" | "club" | "food" | "restaurant";
export type VenueKindVisibility = Record<Exclude<CuratedVenueKind, "club">, boolean> & {
  club?: boolean;
  cafe?: boolean;
  hotel_lounge?: boolean;
  library?: boolean;
  coworking?: boolean;
  other?: boolean;
};

export function defaultVenueKindVisibility(): VenueKindVisibility {
  return {
    pub: true,
    bar: true,
    club: true,
    food: true,
    restaurant: true,
    cafe: false,
    hotel_lounge: false,
    library: false,
    coworking: false,
    other: false,
  };
}

export function toggleVenueKind(
  current: VenueKindVisibility,
  kind: CuratedVenueKind,
): VenueKindVisibility {
  const visible = kind === "club" ? (current.club ?? current.bar) : current[kind];
  return { ...current, [kind]: !visible };
}

export function isPubVenueKind(kind: VenueKind | undefined): boolean {
  return kind === undefined || kind === "pub";
}

export function isPubVenue(venue: Venue): boolean {
  return isPubVenueKind(venue.kind);
}

// THE CHEAPEST-PINT RANKINGS ARE FOR BARS A STRANGER CAN WALK INTO. The listing
// we import holds real prices at bars a member of the public cannot use: a
// students' union bar (The Three Tuns, LSE SU, topped Westminster at £2.95), a
// working men's club, a services or social club. The price is real and the row
// stays in the dataset and on the map, but a "cheapest listed pints" answer that
// sends a reader to a door they will be turned away from is a wrong answer. The
// dataset has no access field, so the name is the only evidence we hold, and
// these are the words that say the bar is for members, students or staff.
const NON_PUBLIC_VENUE_NAME = new RegExp(
  [
    String.raw`\bstudents?['’]?\s*(?:['’]s\s*)?union\b`,
    String.raw`\bstudents?['’]?\s+bar\b`,
    String.raw`\bstaff\s+(?:bar|club)\b`,
    String.raw`\bmembers['’]?\s*(?:only|club|bar)\b`,
    String.raw`\bworking\s*men['’]?s['’]?\s+club\b`,
    String.raw`\bsocial\s+club\b`,
    String.raw`\bsports\s+(?:and|&)\s+social\b`,
    String.raw`\b(?:constitutional|conservative|labour|liberal|services|railway|supporters['’]?)\s+club\b`,
    String.raw`\bex[-\s]?servicemen\b`,
    String.raw`\b(?:royal\s+)?british\s+legion\b`,
    String.raw`\b(?:officers|sergeants)['’]?\s+mess\b`,
  ].join("|"),
  "i",
);

// "SU" alone is a students' union only in capitals, so it is matched with case.
const STUDENTS_UNION_INITIALS = /(?:^|[\s(\-–,])SU(?:$|[\s)\-–,])/;

/** True when the venue's own name says it is not open to the public. */
export function isNonPublicVenueName(name: string): boolean {
  return NON_PUBLIC_VENUE_NAME.test(name) || STUDENTS_UNION_INITIALS.test(name);
}

/**
 * THE ONE ELIGIBILITY RULE for every public cheapest-pint ranking (Tonight's
 * cheapest listed pints, the landing rail, Near me, the borough and discover
 * boards): a pub kind, and a bar the public can walk into.
 */
export function isPublicRankablePub(venue: { kind?: VenueKind; name: string }): boolean {
  return isPubVenueKind(venue.kind) && !isNonPublicVenueName(venue.name);
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
 * An absent kind retains Pub visibility. A missing Club choice follows Bars.
 * Other missing choices stay hidden until the caller explicitly enables them.
 */
export function filterVenuesByKind(
  venues: Venue[],
  visibility: VenueKindVisibility,
): Venue[] {
  return venues.filter((venue) => {
    const kind = venue.kind === undefined ? "pub" : venue.kind;
    if (kind === "club") return visibility.club ?? visibility.bar;
    return visibility[kind] ?? false;
  });
}

/**
 * The venue kinds the map's own filter offers, in the order it draws them.
 *
 * The desktop chips live behind one Filters control, so the badge on the closed
 * control and the chips inside it must count the SAME set: a badge that counted
 * a kind the open panel never offers would say a filter is on over a control
 * nobody can reach. Every view offers all five curated kinds. The experience
 * lens decides which venues qualify within those kinds.
 */
const CURATED_VENUE_KIND_ORDER: readonly CuratedVenueKind[] = [
  "pub",
  "bar",
  "club",
  "food",
  "restaurant",
];

export function offeredVenueKinds(
  experienceLens: string,
): readonly CuratedVenueKind[] {
  // Keep the shared count/reset call contract while every lens offers this set.
  void experienceLens;
  return CURATED_VENUE_KIND_ORDER;
}

/** How many of the offered kinds the reader has switched off. */
export function hiddenVenueKindCount(
  visibility: VenueKindVisibility,
  experienceLens: string,
): number {
  return offeredVenueKinds(experienceLens).filter((kind) =>
    kind === "club" ? !(visibility.club ?? visibility.bar) : !visibility[kind],
  ).length;
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
