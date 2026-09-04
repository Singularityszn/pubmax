// The landing hero prototype (issue #1357, map #1354). Pure: no fs, no React.
//
// Three variants sit behind `/?hero=a|b|c` on the real landing page. Each one
// lands on the answer: one real pub, its listed price, the standing that price
// has earned, who listed it and when, and the archive's "then" line where the
// archive holds one. The first tap is a receipt: "Still £6.50?" opens the Pint
// Drop door for that pub, and nothing else on the screen wears the coral.
//
//   a  the answer card alone
//   b  the answer card plus three next-cheapest rows
//   c  the answer card with the Pub Pal as the quiet second door
//
// "Near the visitor" is a browser fact the prerendered document cannot know,
// so the document ships the anchor pub and the browser swaps in the cheapest
// listed pint within a walk ONLY when the reader already granted location, or
// taps the one quiet control that asks. The landing never asks on arrival:
// `?locate=1` is the geolocation ask and it rides a deliberate tap alone.

import { formatGbp } from "@/lib/formatGbp";
import { priceStandingFor, type PriceStanding } from "@/lib/priceTier";
import { venueMapUrl } from "@/lib/venueMapUrl";

export const HERO_VARIANTS = ["a", "b", "c"] as const;
export type HeroVariant = (typeof HERO_VARIANTS)[number];

/** The query key the prototype reads: `/?hero=a`. */
export const HERO_QUERY_KEY = "hero";

export function parseHeroVariant(value: unknown): HeroVariant | null {
  return typeof value === "string" && (HERO_VARIANTS as readonly string[]).includes(value)
    ? (value as HeroVariant)
    : null;
}

/** How many next-cheapest rows variant B shows under the answer. */
export const HERO_RAIL_SIZE = 3;

/** One dated archive price, as the document ships it beside the answer. */
export type LandingArchiveThen = {
  priceGbp: number;
  /** `YYYY-MM-DD` as the archive states it. */
  observedOn: string;
  /** "July 2013", the granularity the card prints the claim at. */
  observedMonth: string;
  /** "14 July 2013", for the source line. */
  observedDay: string;
  source: { label: string; url: string };
};

/**
 * The archive, keyed by venue id, for every priced pub that carries a dated
 * row. Built at prerender and shipped inline so the browser can print a then
 * line under a near-you answer without importing the history lane, which
 * `__tests__/priceHistory.test.ts` fences to three modules.
 */
export type LandingArchiveIndex = Record<string, LandingArchiveThen>;

/** One next-cheapest row under the answer (variant B). */
export type LandingRailRow = {
  id: string;
  name: string;
  area: string;
  priceGbp: number;
  /** Walking minutes from the reader, present only under a location fix. */
  walkMinutes?: number;
  /** Whether the archive holds a dated row for this pub. */
  hasThen: boolean;
};

/** Where the answer came from. The kicker and the rail heading read it. */
export type LandingAnswerScope =
  /** The document's anchor pub, chosen at build. */
  | "anchor"
  /** The cheapest listed pint inside a ~12 minute walk of the reader. */
  | "walkable"
  /** Too few priced pubs in the walk, so the nearest priced ones. */
  | "widened";

/** The one filled action on the hero. */
export function stillPriceLabel(priceGbp: number): string {
  return `Still ${formatGbp(priceGbp)}?`;
}

/**
 * The Pint Drop door for one pub: the map opens on that pub with the composer
 * open (`log=1` is the owned log intent `components/PubMap.tsx` honours).
 */
export function pintDropDoorHref(venueId: string): string {
  return `${venueMapUrl(venueId)}&log=1`;
}

/** The line above the answer card. */
export function answerKicker(scope: LandingAnswerScope, area: string): string {
  switch (scope) {
    case "walkable":
      return "Cheapest listed near you";
    case "widened":
      return "Nearest listed pint";
    case "anchor":
      return area;
  }
}

/** The heading over variant B's rows. */
export function railHeading(scope: LandingAnswerScope, area: string): string {
  return scope === "anchor" ? `Cheapest listed in ${area}` : "Next cheapest";
}

/** The one quiet control that asks for a location. */
export const NEAR_ME_CONTROL_LABEL = "Near me";
export const NEAR_ME_CONTROL_BUSY_LABEL = "Finding you…";
/** The one line said after a location the browser would not give. */
export const NEAR_ME_FAILED_LINE = "Location is off, so this is our pick.";
/** Said when the fix landed nowhere the index prices. */
export const NEAR_ME_NOTHING_LINE = "No listed prices within a walk of you yet.";

/**
 * The standing a near-you answer earns. The prototype reads the near-price
 * trust API, which names a publisher only when the row carries a public page,
 * so a named publisher is the listed claim inside its window and anything else
 * is `none`. Shipping this means carrying the page URL on that API so the ONE
 * decider (`priceStandingFor`) reads it directly.
 */
export function nearAnswerStanding(
  publisherNamed: boolean,
  collectedOn: string,
  now: number = Date.now(),
): PriceStanding {
  if (!publisherNamed) return "none";
  return priceStandingFor(
    {
      listed: {
        priceGbp: 1,
        sourceUrl: "https://prices.example/prototype-stand-in",
        observedAt: `${collectedOn}T12:00:00.000Z`,
      },
    },
    now,
  ).standing;
}

/** Which variant shows the rail, and which shows the Pal. */
export function heroShowsRail(variant: HeroVariant): boolean {
  return variant === "b";
}
export function heroShowsPal(variant: HeroVariant): boolean {
  return variant === "c";
}
