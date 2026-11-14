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
import { priceStandingFor, type PriceStanding } from "@/lib/priceTier";
import { venueMapUrl } from "@/lib/venueMapUrl";

/** How many next-cheapest rows sit under the answer. */
export const HERO_RAIL_SIZE = 3;
export const LANDING_HERO_ZONE = 1;

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
  /**
   * The movement lib/priceHistory.ts allowed against ONE listed figure, decided
   * at build, or null when the two figures cannot be shown to be the same pint.
   */
  movement: { nowGbp: number; line: string } | null;
};

/**
 * The archive, keyed by venue id, for every priced pub that carries a dated
 * row. Built at prerender and shipped inline so the browser can print a then
 * line under a near-you answer without importing the history lane, which
 * `__tests__/priceHistory.test.ts` fences to three modules.
 */
export type LandingArchiveIndex = Record<string, LandingArchiveThen>;

/**
 * The movement a then line may print beside `priceGbp`, or null. A near-you
 * answer can print a figure from another read, and a movement decided against
 * one figure says nothing about a different one.
 */
export function archiveMovementLine(then: LandingArchiveThen, priceGbp: number): string | null {
  const movement = then.movement;
  return movement && Math.abs(movement.nowGbp - priceGbp) < 0.005 ? movement.line : null;
}

/** One next-cheapest row under the answer. */
export type LandingRailRow = {
  id: string;
  name: string;
  area: string;
  primaryBorough: string;
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

/**
 * The Pal-first front door keeps model access behind sign-in.
 * Signed-in readers go straight to chat without companion customisation.
 * Guests keep that destination through the existing sign-in route.
 * The quiet near-me door still answers without an account or setup.
 */
export const LANDING_PRIMARY_HREF = "/pal/chat";
export const LANDING_PRIMARY_LABEL = "Ask your Pub Pal";
export const LANDING_SIGN_IN_HREF = "/login?from=%2Fpal%2Fchat";
export const LANDING_SIGN_IN_LABEL = "Sign in for Pub Pal";

/**
 * The receipt door's one label, with or without a card behind it (UX audit
 * 16 Oct 2026). It used to read "Still £6.50?", which asked a stranger a
 * riddle about a pub they had never seen; the label now says what the tap
 * does. The general door asks which pub the reader is in before opening
 * a blank price form. Pub-specific confirmation links keep their own seed.
 */
export const LANDING_RECEIPT_LABEL = "Log what you paid";
/** The general price door asks the reader to choose a pub first. */
export const LANDING_FALLBACK_RECEIPT_HREF = "/map?log=1";

/**
 * The Pint Drop door for one pub: the map opens on that pub with the composer
 * open (`log=1` is the owned log intent `components/PubMap.tsx` honours).
 *
 * #1462 — the figure rides with the intent. A tap from a card that printed
 * £6.50 landing on an empty field asks the reader to type back the number it
 * just showed them, so the door carries the price the card printed and the
 * composer opens holding it. It is a SEED and not a submission: `lib/mapLogIntent.ts`
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

export function railHeading(scope: LandingAnswerScope): string {
  return scope === "anchor" ? `Cheapest listed in Zone ${LANDING_HERO_ZONE}` : "Next cheapest";
}

/**
 * The anchor card's zone chip. The zone is the nearest station's, so the chip
 * names that station: the approximation is on the page, not in a footnote.
 */
export function anchorZoneChip(station: { name: string; zone: number }): { text: string; label: string } {
  return {
    text: `Zone ${station.zone} · near ${station.name}`,
    label: `Zone ${station.zone}, by its nearest station, ${station.name}`,
  };
}

/**
 * The quiet row keeps both price doors beside the Pal-first action.
 * The receipt door starts with a pub choice, not the featured pub's price.
 * Near me still answers without sign-in, including when location is refused.
 * Plan remains in the existing navigation and follows a selected Pal answer.
 */
export const LANDING_NEAR_HREF = "/near?locate=1";
const NEAR_DOOR_LABEL = "Cheapest pints near me";

export type LandingQuietDoor = {
  href: Route;
  label: string;
  /** The `landing_cta_clicked` target this door reports. */
  cta: "near";
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
    href: LANDING_NEAR_HREF,
    label: NEAR_DOOR_LABEL,
    cta: "near",
    className: "lpNearDoor",
  },
];

/** The one line said after a location the browser would not give. */
export const NEAR_ME_FAILED_LINE = "Location is off, so this is our pick.";
/** Said when the fix landed nowhere the index prices. */
export const NEAR_ME_NOTHING_LINE = "No listed prices within a walk of you yet.";

export type AnswerPublisher = { label: string; url: string };

/**
 * THE ONE place the card's publisher and standing are read off a pub's price
 * rows: only a row that carries the printed figure can name its publisher.
 * The standing is what `priceStandingFor` says
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
    const carriesFigure =
      typeof row.price_gbp === "number" && Math.abs(row.price_gbp - input.priceGbp) < 0.005;
    if (!carriesFigure) continue;
    const named = namedLegacyPintPriceSource(row);
    if (!named) continue;
    evidence = { row, publisher: { label: named.label, url: named.url } };
    break;
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

/** The visible introduction stays independent of metadata and link-preview copy. */
export const LANDING_INTRO = "Tell your Pub Pal what you fancy. Pick a London pub and make a Plan your friends can join.";
