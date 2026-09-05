// The landing hero: land on the answer, and make the first tap a receipt.
// Pure: no fs, no React. Captain decision 2026-09-04 (issue #1357, map #1354),
// picked as variant B off the prototype board: the answer card plus three
// next-cheapest rows.
//
// The card is one real pub with its listed price, the standing that price has
// earned, who listed it and when, and the archive's "then" line where the
// archive holds one. The one filled action is "Still £6.50?", which opens the
// Pint Drop door for that pub. The Pal stays the quiet second door.
//
// "Near the visitor" is a browser fact the prerendered document cannot know,
// so the document ships the anchor pub and the browser swaps in the cheapest
// listed pint within a walk ONLY when the reader already granted location, or
// taps the one quiet control that asks. The landing never asks on arrival:
// `?locate=1` is the geolocation ask and it rides a deliberate tap alone.

import { namedLegacyPintPriceSource, type LegacyPintPrice } from "@/lib/drinks";
import { formatGbp } from "@/lib/formatGbp";
import { priceStandingFor, type PriceStanding } from "@/lib/priceTier";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** How many next-cheapest rows sit under the answer. */
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
  /** Whole years from the then row to the build, the same count the card prints. */
  years: number;
  source: { label: string; url: string };
};

/**
 * The archive, keyed by venue id, for every priced pub that carries a dated
 * row. Built at prerender and shipped inline so the browser can print a then
 * line under a near-you answer without importing the history lane, which
 * `__tests__/priceHistory.test.ts` fences to three modules.
 */
export type LandingArchiveIndex = Record<string, LandingArchiveThen>;

/** One next-cheapest row under the answer. */
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

/** The one filled action on the hero when the card is present. */
export function stillPriceLabel(priceGbp: number): string {
  return `Still ${formatGbp(priceGbp)}?`;
}

/** The receipt door when no card can back an answer: the same door as before. */
export const LANDING_FALLBACK_PRIMARY_HREF = "/near?locate=1";
export const LANDING_FALLBACK_PRIMARY_LABEL = "Log what you paid";

/**
 * The Pint Drop door for one pub: the map opens on that pub with the composer
 * open (`log=1` is the owned log intent `components/PubMap.tsx` honours).
 *
 * #1462 — the figure rides with the intent. A tap that says "Still £6.50?" and
 * lands on an empty field is asking the reader to type back the number it just
 * showed them, so the door carries the price the card printed and the composer
 * opens holding it. It is a SEED and not a submission: `lib/mapLogIntent.ts`
 * ignores anything that is not a positive GBP figure, the field stays editable,
 * and nothing is written until the drinker presses Log it.
 */
export function pintDropDoorHref(venueId: string, priceGbp?: number): string {
  const door = `${venueMapUrl(venueId)}&log=1`;
  return typeof priceGbp === "number" && Number.isFinite(priceGbp) && priceGbp > 0
    ? `${door}&price=${priceGbp.toFixed(2)}`
    : door;
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

/** The heading over the rail. */
export function railHeading(scope: LandingAnswerScope, area: string): string {
  return scope === "anchor" ? `Cheapest listed in ${area}` : "Next cheapest";
}

/**
 * The second quiet door on the hero's own row (#1488).
 *
 * Tonight had no tap at all on the phone's home screen: the landing bar hides
 * its link list under 960px, the six-tab dock carries Now rather than Tonight,
 * and the only rendered `/tonight` link sat in the footer about 3,500px down.
 * It rides the Pal door's row because the phone's first screen ends at the
 * consent bar a couple of dozen pixels under that row, so a row of its own
 * would be a door nobody sees.
 */
export const TONIGHT_DOOR_HREF = "/tonight";
export const TONIGHT_DOOR_LABEL = "Tonight";

/** The one quiet control that asks for a location. */
export const NEAR_ME_CONTROL_LABEL = "Near me";
export const NEAR_ME_CONTROL_BUSY_LABEL = "Finding you…";
/** The one line said after a location the browser would not give. */
export const NEAR_ME_FAILED_LINE = "Location is off, so this is our pick.";
/** Said when the fix landed nowhere the index prices. */
export const NEAR_ME_NOTHING_LINE = "No listed prices within a walk of you yet.";

export type AnswerPublisher = { label: string; url: string };

/**
 * THE ONE place the card's publisher and standing are read off a pub's price
 * rows: the first row naming a public page is the publisher, and the standing
 * is what `priceStandingFor` says about that page and the collection day. The
 * prerendered anchor and a near-you swap both come through here, so a pub
 * cannot read one way at build and another after a tap.
 */
export function answerEvidenceFor(
  input: { priceGbp: number; prices: readonly LegacyPintPrice[]; collectedOn: string },
  now: number = Date.now(),
): { publisher: AnswerPublisher | null; standing: PriceStanding } {
  let publisher: AnswerPublisher | null = null;
  for (const row of input.prices) {
    const named = namedLegacyPintPriceSource(row);
    if (named) {
      publisher = { label: named.label, url: named.url };
      break;
    }
  }
  const { standing } = priceStandingFor(
    {
      listed: publisher
        ? {
            priceGbp: input.priceGbp,
            sourceUrl: publisher.url,
            observedAt: `${input.collectedOn}T12:00:00.000Z`,
          }
        : null,
    },
    now,
  );
  return { publisher, standing };
}
