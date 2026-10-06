// Where one /out listing goes, and what the page leads with.
//
// A listing's route is the source's OWN event page when it published one - the
// credit and the link are one claim (lib/out/attribution.ts), and a publisher
// whose link lands on a front door has published no route at all. A row with no
// event page falls back to the pub it was matched to; a row with neither is a
// real row that simply does not open, and it says so by not being a link.
//
// A listing is NEVER the page's primary. The primary is a product action (the
// map), handed to the Screen by the page itself. /out once painted the first
// listing's title as its filled button, and on 13 Sep 2026 that was a
// Ticketmaster theatre show ("Burlesque") on a night where the match had placed
// none of 25 listings at a pub we list. A listing opens from its own card.

import type { Route } from "next";
import type { AppOrExternalLink } from "@/lib/appLink";
import { firstHttp } from "@/lib/httpUrl";
import { outRowSourceCredit } from "@/lib/out/attribution";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import type { OutVenueMatchStatus } from "@/lib/out/venueMatch";
import { outWindowNoun, type OutDayWindow } from "@/lib/outListings";
import type { WhatsOnRow } from "@/lib/whatsOn";

/** `external` is true when the route leaves PUBMAXX for the publisher's own page. */
export type OutListingRoute = AppOrExternalLink;

/** The route one listing opens, or null when the sources published none. */
export function outListingRoute(row: WhatsOnRow): OutListingRoute | null {
  const credit = outRowSourceCredit({
    label: row.source?.label ?? "",
    url: row.source?.url ?? "",
  });
  const sourceUrl = credit.href ? firstHttp(credit.href) : null;
  if (sourceUrl) return { href: sourceUrl, external: true };
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) {
    const href: Route = `/map?sel=${encodeURIComponent(venueId)}`;
    return { href, external: false };
  }
  return null;
}

/** The heading over listings without a confirmed pub match. */
export const OUT_NOT_ON_MAP_HEADING = "Places we couldn’t match";

/** The way from a night with no confirmed pub matches to pubs people talk about. */
export const OUT_TONIGHT_PUBS_WAY = { href: "/tonight", label: "Tonight’s pubs" } as const;

export type OutListingLead = {
  /**
   * True only when the venue match RAN. A split claims the second block has no
   * confirmed pub match, and a lookup nobody performed cannot make that claim.
   */
  split: boolean;
  /** Listings with a confirmed pub match, in served order. They lead. */
  matched: WhatsOnRow[];
  /** Every other listing, in served order. Shown under its heading, never hidden. */
  unmatched: WhatsOnRow[];
  /** The line that leads when the match ran and placed none of them. */
  honestEmpty: {
    line: string;
    way: typeof OUT_TONIGHT_PUBS_WAY | null;
  } | null;
};

function honestEmptyLine(window: OutDayWindow, count: number): string {
  const possessive = `${outWindowNoun(window)}’s`;
  if (count === 1) {
    return `We couldn’t match ${possessive} listing to a pub on our map.`;
  }
  return `We couldn’t match any of ${possessive} ${count} listings to a pub on our map.`;
}

/**
 * What /out leads with once it holds listings.
 *
 * When the match ran, a listing with a confirmed pub match leads and the rest
 * follow under OUT_NOT_ON_MAP_HEADING. When it ran and placed none, the honest line leads, so
 * a reader meets what we checked before a block of ticket listings. When it did
 * not run, nothing is split and nothing is claimed: outVenueMatchNotice says so.
 */
export function outListingLead(
  rows: readonly WhatsOnRow[],
  venueMatch: OutVenueMatchStatus | undefined,
  window: OutDayWindow,
): OutListingLead {
  if (venueMatch !== "ready") {
    return { split: false, matched: [], unmatched: [...rows], honestEmpty: null };
  }
  const matched: WhatsOnRow[] = [];
  const unmatched: WhatsOnRow[] = [];
  for (const row of rows) {
    (canonicalOutVenueId(row.venueId) ? matched : unmatched).push(row);
  }
  const honestEmpty =
    matched.length === 0 && unmatched.length > 0
      ? {
          line: honestEmptyLine(window, unmatched.length),
          way: window === "tonight" ? OUT_TONIGHT_PUBS_WAY : null,
        }
      : null;
  return { split: true, matched, unmatched, honestEmpty };
}
