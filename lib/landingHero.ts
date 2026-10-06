// The landing hero: show London, then answer in one tap.
// Pure: no fs, no React. Captain decision 2026-09-04 (issue #1357, map #1354)
// gave the hero its answer card and three next-cheapest rows; the captain's
// 7 September 2026 rebuild put a drawing of London above them and moved the one
// filled action onto /near.
//
// The card under the picture is one real pub with its listed price, the
// standing that price has earned, who listed it and when, and the archive's
// "then" line where the archive holds one. Its "Still £6.50?" door is now the
// first QUIET door rather than the primary, because it ends in a sign-in ask
// and a stranger has to be given something first.
//
// "Near the visitor" is a browser fact the prerendered document cannot know,
// so the document ships the anchor pub and the browser swaps in the cheapest
// listed pint within a walk ONLY when the reader already granted location, or
// taps the one quiet control that asks. The landing never asks on arrival:
// `?locate=1` is the geolocation ask and it rides a deliberate tap alone.

import type { Route } from "next";
import {
  legacyPintPriceObservedAt,
  legacyPintPriceObservedOn,
  namedLegacyPintPriceSource,
  type LegacyPintPrice,
} from "@/lib/drinks";
import { WEB_ONBOARDING_START_HREF } from "@/lib/firstRunRoute";
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

/**
 * THE ONE PRIMARY ON THE FRONT DOOR (captain 7 Sep 2026).
 *
 * It used to be "Still £6.50?", the Pint Drop door for a pub the reader had
 * never seen, and that door ends in a sign-in ask before anybody has been given
 * anything (the live walk's B3, and PlanAstra section 3 removes it by name).
 * `/near` answers instead: it geolocates on this tap alone, and a reader who
 * says no is answered from a London patch rather than a wall
 * (components/nearme/NearMeNow.tsx). One tap, an answer, no account.
 */
export const LANDING_PRIMARY_HREF = "/near?locate=1";
export const LANDING_PRIMARY_LABEL = "Cheapest pints near me";

/**
 * Where the primary goes for this visitor. A first-time visitor (no seen mark,
 * lib/firstRunTour.ts) takes the first-run journey first, and its Skip lands on
 * `LANDING_PRIMARY_HREF`. A returning visitor goes straight there. Only the
 * landing's own primary asks: a deep link or any other path never meets it.
 */
export function landingPrimaryHref(
  seenOnboarding: boolean,
): typeof LANDING_PRIMARY_HREF | typeof WEB_ONBOARDING_START_HREF {
  return seenOnboarding ? LANDING_PRIMARY_HREF : WEB_ONBOARDING_START_HREF;
}

/** The receipt door when no card can back one: the plain price door. */
export const LANDING_FALLBACK_RECEIPT_HREF = "/near";
export const LANDING_FALLBACK_RECEIPT_LABEL = "Log what you paid";

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
export function pintDropDoorHref(venueId: string, priceGbp?: number): Route {
  const door = `${venueMapUrl(venueId)}&log=1`;
  // `door` is a venueMapUrl() Route with its query open, so appending keeps it one.
  return (typeof priceGbp === "number" && Number.isFinite(priceGbp) && priceGbp > 0
    ? `${door}&price=${priceGbp.toFixed(2)}`
    : door) as Route;
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
 * The hero's quiet row (#1488, rebuilt 7 Sep 2026).
 *
 * Tonight had no tap at all on the phone's home screen: the landing bar hides
 * its link list under 960px, the six-tab dock carries Now rather than Tonight,
 * and the only rendered `/tonight` link sat in the footer about 3,500px down.
 * It keeps its place here.
 *
 * The Pint Drop door rides beside it as the FIRST quiet door. It was the
 * landing's primary until the captain moved the front door onto `/near`, and it
 * is dynamic (it carries the anchor pub's own id and price), so it cannot live
 * in this table. `components/landing/LandingHero.tsx` renders it and this table
 * holds the rest of the row.
 */
const TONIGHT_DOOR_HREF = "/tonight";
const TONIGHT_DOOR_LABEL = "Tonight";

export type LandingQuietDoor = {
  href: Route;
  label: string;
  /** The `landing_cta_clicked` target this door reports. */
  cta: "tonight";
  /** A class the door carries for its own width rule, where it has one. */
  className?: string;
};

/**
 * The static half of the quiet row. The Screen primitive caps that row at two
 * doors, the receipt door takes the first place, so this table holds one.
 * `__tests__/landingFindMyPintHierarchy.test.ts` counts the rendered anchors
 * against it, so a door added or dropped in one place fails the other rather
 * than reading as a number somebody typed (#1503).
 */
export const LANDING_QUIET_DOORS: readonly LandingQuietDoor[] = [
  {
    href: TONIGHT_DOOR_HREF,
    label: TONIGHT_DOOR_LABEL,
    cta: "tonight",
    className: "lpTonightDoor",
  },
];

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
 * rows: the row naming a public page is the publisher, preferring the one that
 * carries the printed figure, and the standing is what `priceStandingFor` says
 * about that page and the day THAT ROW was last read at its source. The
 * prerendered anchor and a near-you swap both come through here, so a pub
 * cannot read one way at build and another after a tap.
 *
 * The day is the row's own, never the dataset's collection day: a
 * re-collection re-reads only the rows its source still states, and a row it
 * did not read keeps the day it was read. A row that records no read cannot
 * claim a listing.
 */
export function answerEvidenceFor(
  input: { priceGbp: number; prices: readonly LegacyPintPrice[] },
  now: number = Date.now(),
): { publisher: AnswerPublisher | null; standing: PriceStanding; observedOn: string | null } {
  let evidence: { row: LegacyPintPrice; publisher: AnswerPublisher } | null = null;
  for (const row of input.prices) {
    const named = namedLegacyPintPriceSource(row);
    if (!named) continue;
    const carriesFigure =
      typeof row.price_gbp === "number" && Math.abs(row.price_gbp - input.priceGbp) < 0.005;
    if (!evidence || carriesFigure) {
      evidence = { row, publisher: { label: named.label, url: named.url } };
    }
    if (carriesFigure) break;
  }
  const publisher = evidence?.publisher ?? null;
  const observedAt = evidence ? legacyPintPriceObservedAt(evidence.row) : null;
  const observedOn = evidence ? legacyPintPriceObservedOn(evidence.row) : null;
  const { standing } = priceStandingFor(
    {
      listed:
        publisher && observedAt
          ? { priceGbp: input.priceGbp, sourceUrl: publisher.url, observedAt }
          : null,
    },
    now,
  );
  return { publisher, standing, observedOn };
}
