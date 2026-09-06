// GET /api/spoons-value?venueId= — what the Spoons value ranking holds about
// one pub, for the sheet that pub opens in.
//
// ONE ROUTE FOR BOTH SHEETS. A curated Wetherspoon opens VenueOverviewTab and a
// national base pub opens UnverifiedPubSheet, and 676 of the 788 pubs this lane
// joins are base pins. Carrying the answer on each sheet's own detail response
// would have meant two sources for one row, which is the drift every law in
// this tree exists to stop. The body is a few hundred bytes and edge-cacheable,
// because a published menu reading does not change between two readers.
//
// A pub the ranking does not hold answers `ready` with a null row: that is an
// ANSWER, and the row renders nothing. Only a read we could not run degrades.

import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { spoonsValueRowFor } from "@/lib/spoonsValue.server";
import { clientIp, hashIp } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`spoons-value:${ipHash}`, `spoons-value:${ipHash}`, 120)) ||
    (await isLimited("spoons-value:global", "spoons-value:global", 1200))
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const venueId = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!venueId) {
    return publicApiError("Add a venue id.", "INVALID_REQUEST", 400);
  }

  const held = await spoonsValueRowFor(venueId);
  if (held.status === "unavailable") {
    return publicApiError("The ranking could not be read.", "UNAVAILABLE", 503, {
      retryable: true,
    });
  }

  return Response.json(
    {
      status: "ready",
      spoonsValue:
        held.row && held.credit
          ? {
              row: held.row,
              modalMilliunits: held.modalMilliunits,
              rankedCount: held.rankedCount,
              credit: held.credit,
            }
          : null,
    },
    {
      headers: {
        // An imported edition changes only when it is re-imported by hand, so
        // this answer is the same for every reader for a long time.
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
