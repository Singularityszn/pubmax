// Ledger title disambiguation (SEO audit #2126, D5) uses only the venue's own
// area and address. Missing address facts must not become invented suffixes.
// __tests__/ledgerTitle.test.ts owns the approved collisions without postcodes.
// Sibling comparisons use bundled facts to avoid live detail-read fan-out.

import { venueStreetLabel } from "@/lib/routeStops";
import { displayVenueName, venueAreaLabel } from "@/lib/venueDisplay";

type NamedVenue = { id: string; name: string; borough?: string; retired?: true };

type LedgerTitleVenue = {
  id: string;
  name: string;
  address?: string | null;
  locality?: string | null;
  primaryBorough?: string | null;
};

type NameCounts = { byName: Map<string, number>; byNameAndBorough: Map<string, number> };

const countsByIndex = new WeakMap<ReadonlyMap<string, NamedVenue>, NameCounts>();

function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Both sides go through the reader-facing name, so "The Crown - JD
// Wetherspoon" and "The Crown" count as one name, as a reader sees them.
function nameKey(name: string): string {
  return normalise(displayVenueName(name));
}

function boroughKey(name: string, borough: string | null | undefined): string {
  return `${nameKey(name)}|${normalise(borough ?? "")}`;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function nameCounts(index: ReadonlyMap<string, NamedVenue>): NameCounts {
  const cached = countsByIndex.get(index);
  if (cached) return cached;
  const counts: NameCounts = { byName: new Map(), byNameAndBorough: new Map() };
  for (const venue of index.values()) {
    if (venue.retired) continue;
    bump(counts.byName, nameKey(venue.name));
    bump(counts.byNameAndBorough, boroughKey(venue.name, venue.borough));
  }
  countsByIndex.set(index, counts);
  return counts;
}

const NOT_A_STREET = /^(?:london|greater london|uk|united kingdom|england)$/;
const POSTCODE = /\s*\b[A-Z]{1,2}[0-9][A-Z0-9]?(?:\s*[0-9][A-Z]{2})?$/i;
const STREET_WORD =
  /^(?:road|rd|street|st|lane|ln|avenue|ave|terrace|place|pl|walk|hill|hl|way|row|square|sq|grove|gardens|parade|broadway|close|court|crescent|drive|mews|yard|embankment|galleria)$/i;

// "Beckton Road Canning Town Royal Docks E16 1PU" reads "Beckton Road": a
// one-line address runs on past the street, so the street ends at its first
// street word. The first word is never that word, so "St Ann's Terrace" stays whole.
function trimStreet(part: string): string {
  const words = part.replace(POSTCODE, "").trim().split(/\s+/);
  const end = words.findIndex((word, i) => i > 0 && STREET_WORD.test(word));
  return (end === -1 ? words : words.slice(0, end + 1)).join(" ");
}

/**
 * The street from the venue's own address: the first comma part that reads as
 * a street, skipping a bare house number, the pub's name and the area words
 * ("Barnet, Greater London" names no street). Null when no part qualifies.
 */
export function ledgerStreet(venue: Omit<LedgerTitleVenue, "id">): string | null {
  const skip = new Set([nameKey(venue.name), normalise(venueAreaLabel(venue)), normalise(venue.primaryBorough ?? "")]);
  for (const part of (venue.address ?? "").split(",")) {
    const label = venueStreetLabel(part);
    const street = label ? trimStreet(label) : null;
    if (!street) continue;
    const key = normalise(street);
    if (skip.has(key) || NOT_A_STREET.test(key)) continue;
    return street;
  }
  return null;
}

const POSTCODE_PARTS = /\b([A-Z]{1,2}[0-9][A-Z0-9]?)(?:\s*([0-9][A-Z]{2}))?(?=\s*(?:,|$))/i;

function placeTitle(venue: LedgerTitleVenue, counts: NameCounts): string {
  const area = venueAreaLabel(venue);
  const sharedName = (counts.byName.get(nameKey(venue.name)) ?? 0) > 1;
  if (!sharedName) return venue.name;
  const sharedBorough = (counts.byNameAndBorough.get(boroughKey(venue.name, venue.primaryBorough)) ?? 0) > 1;
  const street = sharedBorough ? ledgerStreet(venue) : null;
  return street ? `${venue.name}, ${street}, ${area}` : `${venue.name}, ${area}`;
}

export function ledgerTitleName(
  venue: LedgerTitleVenue,
  index: ReadonlyMap<string, NamedVenue>,
  bundledVenues: readonly LedgerTitleVenue[],
): string {
  const counts = nameCounts(index);
  const title = placeTitle(venue, counts);
  const postcode = venue.address?.match(POSTCODE_PARTS);
  const district = postcode?.[1]?.toUpperCase();
  if (!district || (counts.byName.get(nameKey(venue.name)) ?? 0) < 2) return title;
  const siblings = bundledVenues.filter(
    (other) => other.id !== venue.id
      && index.has(other.id)
      && !index.get(other.id)?.retired
      && nameKey(other.name) === nameKey(venue.name)
      && normalise(placeTitle(other, counts)) === normalise(title),
  );
  if (!siblings.length) return title;
  const sharedDistrict = siblings.some(
    (other) => other.address?.match(POSTCODE_PARTS)?.[1]?.toUpperCase() === district,
  );
  const inward = sharedDistrict ? postcode?.[2]?.toUpperCase() : undefined;
  return `${title} ${district}${inward ? ` ${inward}` : ""}`;
}
