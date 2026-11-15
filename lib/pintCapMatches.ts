import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { hasPintPriceCap } from "@/lib/pintPriceCapValue";
import { pintPriceCapFigure } from "@/lib/pintPriceCaps";
import { hasPintPriceSemantics, type Venue } from "@/lib/venues";

export type PintCapMatches = {
  cap: number;
  priced: number;
  unknown: number;
};

export function pintCapMatches(venues: readonly Venue[], maxPrice: number): PintCapMatches | null {
  if (!hasPintPriceCap(maxPrice)) return null;
  let priced = 0;
  let unknown = 0;
  for (const venue of venues) {
    if (!hasPintPriceSemantics(venue)) continue;
    const price = comparableVenuePint(venue);
    if (price === null) unknown += 1;
    else if (price <= maxPrice) priced += 1;
  }
  return { cap: maxPrice, priced, unknown };
}

/** A failed or pending read is missing data, not a zero result, so it gets no summary. */
export function settledPintCapMatches(
  venues: readonly Venue[],
  maxPrice: number,
  reads: { settled: boolean; failed: boolean },
): PintCapMatches | null {
  return reads.settled && !reads.failed ? pintCapMatches(venues, maxPrice) : null;
}

export type PintCapMatchPart = string | { figure: string };

export function pintCapMatchLines(matches: PintCapMatches): { priced: PintCapMatchPart[]; unknown: PintCapMatchPart[] | null } {
  const cap = { figure: pintPriceCapFigure(matches.cap) };
  const priced = matches.priced === 0
    ? ["No pub in these results has a recorded pint at or under ", cap, ". Try a higher limit or fewer filters."]
    : [{ figure: matches.priced.toLocaleString("en-GB") }, ` ${matches.priced === 1 ? "pub in these results has" : "pubs in these results have"} a recorded pint at or under `, cap, "."];
  if (matches.unknown === 0) return { priced, unknown: null };
  return {
    priced,
    unknown: [
      { figure: matches.unknown.toLocaleString("en-GB") },
      ` ${matches.unknown === 1 ? "pub has" : "pubs have"} no comparable pint price. ${matches.unknown === 1 ? "The cap does not exclude it." : "The cap does not exclude them."}`,
    ],
  };
}
