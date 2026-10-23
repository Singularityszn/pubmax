// GET /api/venue/[id] - the full venue detail (prices or typed anchors,
// amenities, and curation)
// for a single id, loaded server-side so it never rides in the client bundle.
//
// This is the lazy other half of the SLIM-INDEX split: the map fetches
// /data/venues_slim.json (~400 KB) on load to draw pins, then calls THIS route
// only when a venue is opened. Heavy source data stays on the server; a
// visitor downloads full detail for at most the handful of venues they open.
//
// Detail is built from a precomputed line-delimited per-venue artifact generated
// alongside venues_slim.json. The route streams to the selected id, parses that
// one line, then resolves either grouped pub-price rows or a curated venue seed
// through the same detail boundary. That avoids cold-parsing all source data on
// first open while keeping each venue kind's price meaning intact.
//
import { NextResponse } from "next/server";

import { publicApiError } from "@/lib/apiError";

import { canGroupGetIn, estimateBusyness, resolveBookingOption } from "@/lib/busyness";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";
import { BUNDLE_DEFAULT_CATEGORY, bundlePricesForCategory } from "@/lib/ukPriceBundle";
import { ukPriceBundleRowsFor } from "@/lib/ukPriceBundle.server";
import { venuePriceUpdatesFor } from "@/lib/priceUpdates.server";
import { VENUE_DETAIL_INCLUDE_RETIRED_PARAM } from "@/lib/prefetchVenue";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { venueMenuLookupKeys } from "@/lib/venueMenu";
import { venueAmenityStatus, venueContacts, type Venue, type VenuePrice } from "@/lib/venues";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`venue-detail:${ipHash}`, `venue-detail:${ipHash}`, 120)) ||
    (await isLimited("venue-detail:global", "venue-detail:global", 1200))
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const lookup = await lookupVenueDetail(id);
  const includeRetired =
    new URL(request.url).searchParams.get(VENUE_DETAIL_INCLUDE_RETIRED_PARAM) === "1";

  if (lookup.status === "missing" || (lookup.status === "retired" && !includeRetired)) {
    return publicApiError("Venue not found.", "NOT_FOUND", 404);
  }
  if (lookup.status === "unavailable") {
    return publicApiError("Venue details unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
  const { venue } = lookup;

  // WHAT THE BUNDLE HOLDS ABOUT THIS PUB, carried on the venue so the sheet
  // reads it off the detail it already fetches rather than opening a second
  // request. A read that FAILED contributes nothing here and is not an empty
  // answer either: the sheet falls through to the lanes it always had, which is
  // what it did before this field existed.
  const bundle = await ukPriceBundleRowsFor(venue.id);
  const bundlePrices =
    bundle.status === "unavailable"
      ? null
      : bundlePricesForCategory(bundle.rows, BUNDLE_DEFAULT_CATEGORY);

  // WHAT THE TWO OBSERVED PACKS HOLD ABOUT THIS PUB, scoped here for the same
  // reason the bundle is: the Drinks tab drew a handful of rows about one pub
  // and the packs are national. Measured cold on the audit's phone rig, opening
  // the tab on /map?sel= fetched 1862 KB of drink rows and 1519 KB of food rows
  // for those few. The keys a row may target are the venue's own
  // (lib/venueMenu.ts), and a pack the server could not read publishes null
  // rather than an empty answer.
  const priceUpdates = await venuePriceUpdatesFor(venueMenuLookupKeys(venue));

  // THE CONTACT CONTRACT IS THE ONLY CONTACT ON THE WIRE. The source rows hold
  // four free-text columns nobody validated, and one of them shipped
  // "\u{1F310} https://www.lsesu.com/social/three-tuns/" as a phone number
  // (finding F03). `venueContacts` publishes a field only when the value parses
  // as the thing its column claims to be, and the raw columns are stripped here
  // so no caller can build a `tel:` out of one behind our back.
  const contacts = venueContacts(venue);
  // THE STATUS IS THE ONLY AMENITY ANSWER ON THE WIRE. The ten amenity columns
  // carry yes-shaped values and blanks over 3,760 rows, so `Venue.amenities`
  // rounds a blank to `false` and the body shipped `"food": false` beside
  // `"food": "unknown"` about one pub (finding F03's third claim). Every filter
  // and score inside this tree reads a false as "not known to be true", which
  // is why the record keeps its booleans; an API caller has no such rule and
  // reads an invented negative. So the map is stripped here the way the raw
  // contact columns are, and `venueAmenityStatus` prefers the stamped status.
  const amenityStatus = venueAmenityStatus(venue);
  const publishedVenue = withoutAmenityBooleans(venue);
  const prices = venue.prices.map((row) => withoutRawContacts(row));

  const requestedGroupSize = Number(new URL(request.url).searchParams.get("groupSize") ?? 2);
  const groupSize = Number.isFinite(requestedGroupSize)
    ? Math.max(1, Math.min(30, Math.round(requestedGroupSize)))
    : 2;
  const busyness = estimateBusyness({ timeZone: "Europe/London", openingHours: venue.openingHours });
  const booking = resolveBookingOption(venue.bookingLink);
  const getIn = {
    groupSize,
    ...canGroupGetIn({
      groupSize,
      level: busyness.level,
      hasBookingLink: booking.available,
      evidence: {
        openState: busyness.isOpen,
        reportCount: busyness.reportCount,
        busynessSource: busyness.source,
      },
      timeZone: "Europe/London",
    }),
  };

  return NextResponse.json(
    {
      venue: {
        ...publishedVenue,
        prices,
        contacts,
        amenityStatus,
        bundlePrices,
        priceUpdates,
      },
      busyness,
      getIn,
      booking,
    },
    {
      status: 200,
      headers: {
        // Venue detail itself is static, but the additive day/time estimate is
        // not. Keep the response briefly cacheable without freezing "busy now"
        // for a full day.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}

/**
 * The four free-text columns nobody validated. Named once, so the strip and the
 * `Omit` below cannot drift apart.
 *
 * The row's other free-text URLs (`pub_url`, `constructed_pub_url`,
 * `borough_urls`, `image_url`) deliberately stay. They are not a contact a
 * reader would dial or write to, they are a page the drinks lane links and a
 * photograph the sheet draws, and each is read through a validator at the point
 * of use rather than trusted: `firstHttp` in `lib/drinks.ts`, the host
 * allow-list in `lib/venueImageHosts.server.ts`. Stripping them would take the
 * pub's own menu link off the sheet.
 */
const RAW_CONTACT_COLUMNS = ["phone_number", "email", "website", "booking_link"] as const;

/**
 * One source row with its contact columns removed. They are duplicated by the
 * sanitized `contacts` contract above, and a caller that reads one is a caller
 * reading an unchecked value.
 */
function withoutRawContacts(
  row: VenuePrice,
): Omit<VenuePrice, (typeof RAW_CONTACT_COLUMNS)[number]> {
  const rest: Record<string, unknown> = { ...row };
  for (const column of RAW_CONTACT_COLUMNS) delete rest[column];
  return rest as Omit<VenuePrice, (typeof RAW_CONTACT_COLUMNS)[number]>;
}

/**
 * One venue with its amenity booleans removed. `amenityStatus` supersedes them
 * and says the one thing a boolean cannot: that a blank column is UNKNOWN.
 */
function withoutAmenityBooleans(venue: Venue): Omit<Venue, "amenities"> {
  const rest: Record<string, unknown> = { ...venue };
  delete rest.amenities;
  return rest as Omit<Venue, "amenities">;
}
