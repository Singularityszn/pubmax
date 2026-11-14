import { comparableVenuePint } from "@/lib/comparableVenuePint";
import { hasPintPriceCap } from "@/lib/pintPriceCapValue";
import { nearestPintPriceCap } from "@/lib/pintPriceCaps";
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

export function pintCapMatchLines(matches: PintCapMatches): { priced: string; unknown: string | null } {
  const cap = nearestPintPriceCap(matches.cap).shortLabel;
  const priced = matches.priced === 0
    ? `No loaded pub has a recorded pint at or under ${cap}.`
    : `${matches.priced.toLocaleString("en-GB")} loaded ${matches.priced === 1 ? "pub has" : "pubs have"} a recorded pint at or under ${cap}.`;
  if (matches.unknown === 0) return { priced, unknown: null };
  const subject = matches.unknown === 1 ? "1 pub has" : `${matches.unknown.toLocaleString("en-GB")} pubs have`;
  return {
    priced,
    unknown: `${subject} no recorded pint price. ${matches.unknown === 1 ? "It stays visible, but the cap cannot judge it." : "They stay visible, but the cap cannot judge them."}`,
  };
}
