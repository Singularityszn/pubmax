// GET /api/hygiene?venueId=<venue id>&name=<venue name>&postcode=<postcode or address>
//
// TWO LANES, EXACT FIRST. A venue whose OSM object carries an `fhrs:id` is
// answered from the committed packs (lib/fsaHygienePack.server.ts) as `fact`,
// with the FSA's source, licence and both dates: an exact identity, no upstream
// call. A linked venue the ratings pack has no row for is read live at its
// postcode and matched by that FHRSID alone, never by name. Only a venue OSM
// links to no establishment falls back to the live name-and-postcode match.
// Both live answers are `rating`.
//
// Server-side proxy for the FSA Food Hygiene Rating Scheme (FHRS). The client
// NEVER calls the upstream directly (requirement 1) — this route holds the
// x-api-version header, the per-IP rate floor, and the per-instance cache. It is
// READ-ONLY (no mutation, no certification needed) and wrapped with
// withRouteTiming for the standard one-line-per-request latency envelope.
//
// Contract: 200 with `{ rating: HygieneRating | null }`. An unmatched pub, a
// missing/invalid postcode, or an upstream failure all resolve to
// `{ rating: null }` — no badge, no error surfaced to the sheet (fail-soft). A
// flooded IP gets the flat public error contract (publicApiError) at 429.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveHygieneRating } from "@/lib/foodHygiene";
import { linkedFhrsIdForVenue, packHygieneForVenue } from "@/lib/fsaHygienePack.server";
import { isHygieneLimited } from "@/lib/foodHygieneRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_NAME_LEN = 160;
const MAX_POSTCODE_LEN = 400; // may be a full free-text address; postcode is extracted.
const VENUE_ID = /^venue-[a-z0-9-]{1,80}$/;

export const GET = withRouteTiming("hygiene", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isHygieneLimited(request)) {
    return publicApiError(
      "Too many requests, slow down.",
      "HYGIENE_RATE_LIMITED",
      429,
      { retryable: true, details: { rating: null } },
    );
  }

  const params = new URL(request.url).searchParams;
  const venueId = params.get("venueId")?.trim() ?? "";
  const knownVenue = VENUE_ID.test(venueId);
  const fact = knownVenue ? await packHygieneForVenue(venueId) : null;
  if (fact) return jsonNoStore({ rating: null, fact });
  const fhrsid = knownVenue ? await linkedFhrsIdForVenue(venueId) : null;

  const name = params.get("name")?.trim() ?? "";
  const postcode = params.get("postcode")?.trim() ?? params.get("address")?.trim() ?? "";

  if (!name || name.length > MAX_NAME_LEN || !postcode || postcode.length > MAX_POSTCODE_LEN) {
    // Missing/oversized input is treated as "no match" rather than a hard 400 —
    // the sheet simply renders no badge.
    return jsonNoStore({ rating: null });
  }

  const rating = await resolveHygieneRating(name, postcode, fhrsid === null ? {} : { fhrsid });
  return jsonNoStore({ rating });
}
