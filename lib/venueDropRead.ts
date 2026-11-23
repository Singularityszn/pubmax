// WHERE ONE VENUE'S PINT DROP READ GOT TO, and what it may do to what is
// already on screen. A pure leaf: it imports nothing, so the rule can be held
// without mounting the map's whole hook.

/**
 * `idle` means no settled answer, including a read in flight.
 * `ready` means the read answered. `unavailable` means it could not answer.
 * An unavailable read cannot justify a claim that the pub has no prices.
 */
export type VenueDropReadStatus = "idle" | "ready" | "unavailable";

/** What one read of a venue's drops came back with. */
export type VenueDropRead<T> =
  | { readonly status: "ready"; readonly drops: readonly T[] }
  | { readonly status: "unavailable" };

/**
 * The rows a venue holds after a read. A read that ANSWERED replaces them,
 * including with nothing, because an empty answer is a fact about the pub. A
 * read we could not run changes nothing at all, so an absent entry stays absent
 * and a held entry keeps every row it had.
 */
export function venueDropsAfterRead<T>(
  current: readonly T[] | undefined,
  read: VenueDropRead<T>,
): readonly T[] | undefined {
  return read.status === "ready" ? read.drops : current;
}

/**
 * The city list is the newest drops in the city, capped. It colours pins and
 * cannot prove a pub has no drops. A pub whose own read answered keeps those
 * rows, and the city list adds or updates rows by id.
 */
export function cityDropsWithVenueReads<T extends { readonly id: string; readonly createdAt: string }>(
  city: ReadonlyMap<string, readonly T[]>,
  venueReads: ReadonlyMap<string, readonly T[]>,
): Map<string, T[]> {
  const next = new Map<string, T[]>([...city].map(([venueId, rows]) => [venueId, [...rows]]));
  for (const [venueId, read] of venueReads) {
    const cityRows = next.get(venueId) ?? [];
    const cityIds = new Set(cityRows.map((row) => row.id));
    const kept = read.filter((row) => !cityIds.has(row.id));
    if (kept.length === 0) continue;
    next.set(venueId, [...cityRows, ...kept].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  return next;
}
