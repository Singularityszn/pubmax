import type { Route } from "next";
import type { OutOpenPlan } from "@/lib/out";
import {
  outSourceAttribution,
  outSourceAttributionFromLabels,
  type OutSourceCredit,
} from "@/lib/out/attribution";
import { outListingDayGroups, type OutListingDayGroup } from "@/lib/out/listingDays";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import { OUT_UNMATCHED_PLACES_SHOWN } from "@/lib/out/types";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import { outWindowNoun, type OutDayWindow } from "@/lib/outListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/** One listed Open Crew is enough to make discovery useful at London MVP. */
export const OUT_OPEN_PLANS_MIN_SENDABLE = 1;

/**
 * What a row says when it has no confirmed pub link.
 *
 * The listing may still be at a pub on our map. Without a confirmed link,
 * we cannot claim the place is absent. Said on the row itself, because
 * the alternative - counting these rows into one line and printing nothing else
 * - is how /out came to show a reader 148 sourced listings as an empty page.
 */
export const OUT_LISTING_PUB_ABSENT_LINE = "We haven’t linked this place to a pub on our map.";

export { OUT_UNMATCHED_PLACES_SHOWN } from "@/lib/out/types";

export type OutListingGroup = OutListingDayGroup;

export type OutListingPubPair =
  | {
      status: "matched";
      placeName: string;
      mapHref: Route;
    }
  | {
      status: "absent";
      placeName: string;
      line: typeof OUT_LISTING_PUB_ABSENT_LINE;
    };

function normalizePlaceName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function hasResolvedPub(row: WhatsOnRow): boolean {
  return canonicalOutVenueId(row.venueId) !== null;
}

/**
 * /out groups its listings by the night they are on, and prints every one.
 *
 * It used to group by resolved pub and skip any row without one, which meant a
 * night of 63 sourced listings rendered as zero rows and one apologetic count.
 * A listing we hold is a listing we show; whether we also hold the pub is said
 * on the row (outListingPubPair), where it is a footnote rather than a filter.
 */
export function groupOutListings(
  rows: readonly WhatsOnRow[],
  now: number = Date.now(),
): OutListingGroup[] {
  return outListingDayGroups(rows, now);
}

/** Single reader-facing label for the resolved place badge on /out listings. */
export const OUT_LISTING_VENUE_BADGE_LABEL = "On PUBMAXX";

/** The pub beside a gig is the resolved venue on the row, or an unconfirmed match. */
export function outListingPubPair(row: WhatsOnRow): OutListingPubPair {
  const venueId = canonicalOutVenueId(row.venueId);
  const placeName = row.placeName.trim();
  if (venueId) {
    return {
      status: "matched",
      placeName: placeName || venueId,
      mapHref: `/map?sel=${encodeURIComponent(venueId)}`,
    };
  }
  return { status: "absent", placeName, line: OUT_LISTING_PUB_ABSENT_LINE };
}

/** How many listings on screen carry no confirmed pub match. Reported, never hidden. */
export function outListingUnmatchedCount(rows: readonly WhatsOnRow[]): number {
  return rows.reduce((count, row) => (hasResolvedPub(row) ? count : count + 1), 0);
}

/**
 * The one finding a row cannot state for itself.
 *
 * Every listing now prints, and a row with no confirmed pub link says so on
 * its own line, so there is nothing left for a page-level count to reveal. What a row
 * still cannot say is that the MATCH NEVER RAN: the slim venue index failed to
 * read. The row's missing link alone cannot say whether we attempted a lookup.
 * That is this notice's whole remit, and it is silent otherwise.
 */
export type OutVenueMatchNotice = {
  /** The finding, in words a reader can act on. */
  line: string;
  /** The places it is about, or empty when the response named none. */
  places: string;
  /** Who listed the rows. Credit is owed however the match went. */
  credits: OutSourceCredit[];
  /** The one way onward. */
  way: { href: string; label: string };
};

export type OutVenueMatchNoticeOptions = {
  unmatchedCount?: number;
  unmatchedPlaces?: readonly string[];
  unmatchedPlaceCount?: number;
  unmatchedSources?: readonly string[];
};

function joinPlaces(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function outVenueMatchNotice(
  rows: readonly WhatsOnRow[],
  window: OutDayWindow,
  venueMatch: OutVenueMatchStatus | undefined,
  options: OutVenueMatchNoticeOptions = {},
): OutVenueMatchNotice | null {
  if (venueMatch === "ready") return null;
  const unresolved = rows.filter((row) => !hasResolvedPub(row));
  const count = options.unmatchedCount ?? unresolved.length;
  if (count === 0) return null;
  const noun = outWindowNoun(window);
  const possessive = noun === "the weekend" ? "the weekend's" : `${noun}'s`;
  const line = `We couldn't check which of ${possessive} ${count} ${
    count === 1 ? "listing is" : "listings are"
  } at a pub we list.`;

  const names = options.unmatchedPlaces
    ? [...options.unmatchedPlaces]
    : (() => {
        const collected: string[] = [];
        const seen = new Set<string>();
        for (const row of unresolved) {
          const name = row.placeName.trim();
          const key = normalizePlaceName(name);
          if (!name || seen.has(key)) continue;
          seen.add(key);
          collected.push(name);
        }
        return collected;
      })();
  const named = names.slice(0, OUT_UNMATCHED_PLACES_SHOWN);
  const extraPlaceCount =
    options.unmatchedPlaceCount === undefined
      ? names.length - OUT_UNMATCHED_PLACES_SHOWN
      : Math.max(0, options.unmatchedPlaceCount - named.length);
  const places =
    named.length === 0
      ? ""
      : extraPlaceCount > 0
        ? `${named.join(", ")} and ${extraPlaceCount} more ${
            extraPlaceCount === 1 ? "place" : "places"
          }.`
        : `${joinPlaces(named)}.`;

  const way =
    window === "tonight"
      ? { href: "/tonight", label: "See what else is on tonight" }
      : { href: "/map", label: "Find a pub on the map" };

  const credits =
    options.unmatchedSources === undefined
      ? outSourceAttribution(unresolved)
      : outSourceAttributionFromLabels(options.unmatchedSources);
  return { line, places, credits, way };
}

/** A sendable open plan carries a resolved meeting point the card can render. */
export function sendableOpenPlans(plans: readonly OutOpenPlan[]): OutOpenPlan[] {
  return plans.filter((plan) => plan.meetingPoint !== null);
}

/** Hide the whole section rather than show an empty card when the market is thin. */
export function outOpenPlansSectionVisible(plans: readonly OutOpenPlan[]): boolean {
  return sendableOpenPlans(plans).length >= OUT_OPEN_PLANS_MIN_SENDABLE;
}
