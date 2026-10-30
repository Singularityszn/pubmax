// The Ledger's document title names the pub, and two pubs can share a name
// (SEO audit #2126, finding 20): "The Crown" stands in many boroughs. When
// another indexed venue carries the same reader-facing name, the title adds the
// pub's own area, so each ledger page has a title of its own. A unique name
// stays bare, because an area on every title is noise.

import { displayVenueName, venueAreaLabel } from "@/lib/venueDisplay";

type NamedVenue = { id: string; name: string; retired?: true };

const countsByIndex = new WeakMap<ReadonlyMap<string, NamedVenue>, Map<string, number>>();

// Both sides go through the reader-facing name, so "The Crown - JD
// Wetherspoon" and "The Crown" count as one name, as a reader sees them.
function nameKey(name: string): string {
  return displayVenueName(name).trim().toLowerCase().replace(/\s+/g, " ");
}

function nameCounts(index: ReadonlyMap<string, NamedVenue>): Map<string, number> {
  const cached = countsByIndex.get(index);
  if (cached) return cached;
  const counts = new Map<string, number>();
  for (const venue of index.values()) {
    if (venue.retired) continue;
    const key = nameKey(venue.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  countsByIndex.set(index, counts);
  return counts;
}

/** "The Crown, Islington" when another venue shares the name, else "The Crown". */
export function ledgerTitleName(
  venue: { name: string; locality?: string | null; primaryBorough?: string | null },
  index: ReadonlyMap<string, NamedVenue>,
): string {
  const shared = (nameCounts(index).get(nameKey(venue.name)) ?? 0) > 1;
  return shared ? `${venue.name}, ${venueAreaLabel(venue)}` : venue.name;
}
