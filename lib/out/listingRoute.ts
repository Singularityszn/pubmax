// Where one /out listing goes, and what the page's own primary is.
//
// A listing's route is the source's OWN event page when it published one - the
// credit and the link are one claim (lib/out/attribution.ts), and a publisher
// whose link lands on a front door has published no route at all. A row with no
// event page falls back to the pub it was matched to; a row with neither is a
// real row that simply does not open, and it says so by not being a link.
//
// The page's primary is the FIRST listing's route. /out led with "Open the map"
// on every night, listed or quiet, which asked a reader who came to see what is
// on to leave the list to find out. The map keeps its way onward as the quiet
// second door.

import { firstHttp } from "@/lib/httpUrl";
import { outRowSourceCredit } from "@/lib/out/attribution";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import type { WhatsOnRow } from "@/lib/whatsOn";

export type OutListingRoute = {
  href: string;
  /** True when the route leaves PUBMAXX for the publisher's own page. */
  external: boolean;
};

/** The route one listing opens, or null when the sources published none. */
export function outListingRoute(row: WhatsOnRow): OutListingRoute | null {
  const credit = outRowSourceCredit({
    label: row.source?.label ?? "",
    url: row.source?.url ?? "",
  });
  const sourceUrl = credit.href ? firstHttp(credit.href) : null;
  if (sourceUrl) return { href: sourceUrl, external: true };
  const venueId = canonicalOutVenueId(row.venueId);
  if (venueId) return { href: `/map?sel=${encodeURIComponent(venueId)}`, external: false };
  return null;
}

export type OutPrimaryWay = OutListingRoute & {
  /** The listing's own title, which is what the button says. */
  label: string;
  /** The publisher behind it, so the tap is credited the way the row is. */
  sourceLabel: string;
};

/**
 * The page's primary: the first listing that opens anywhere, named by its own
 * title. A list whose rows all open nothing has no listing to lead with, so the
 * caller keeps the map as its primary and this answers null.
 */
export function outPrimaryListingWay(rows: readonly WhatsOnRow[]): OutPrimaryWay | null {
  for (const row of rows) {
    const route = outListingRoute(row);
    const label = row.title.trim();
    if (route && label) return { ...route, label, sourceLabel: row.source?.label ?? "" };
  }
  return null;
}
