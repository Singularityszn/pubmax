// WHERE ONE VENUE'S PINT DROP READ GOT TO, and what it may do to what is
// already on screen. A pure leaf: it imports nothing, so the rule can be held
// without mounting the map's whole hook.
//
// Review finding F-8. `refreshVenueDrops` answered a non-ok response and a
// rejection the same way - it wrote `[]` into the venue's entry.
// `/api/pint-drops` answers 503 whenever its store read throws, so one hiccup
// replaced a pub's real drops with nothing: `pintTrustFor([])` reads `none` and
// the Overview printed the first-drop nudge over a pub holding a confirmed
// price, which is the one sentence #1495 exists to keep off a public drop. The
// city-wide refresh beside it already kept its layer on a failure.

/**
 * `idle` is "not asked yet", `ready` is "asked and answered", `unavailable` is
 * "we could not look". The third is the one that matters: it is what stops a
 * failed read being worded as a pub with no price on it. Deliberately the same
 * three-way shape `VenuePriceReadStatus` uses for the community price lane.
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
