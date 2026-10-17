import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { readLedgerLog } from "@/lib/ledgerLog.server";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { assertServerEnv } from "@/lib/serverEnv";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";

assertServerEnv();

// GET /api/ledger/[id] - the live half of the Ledger. The /ledger/[id] document
// is prerendered and held by the CDN (proxy.ts, CDN_CACHED_DOCUMENT_ROUTES), so
// it carries the pub's bundled facts and nothing a drinker wrote. This route
// answers the rest per request, never cached: the pub's story with its
// drop-derived lines, the public logbook, and the Family Table.
//
// The viewer is the JWT the client sends as `Authorization: Bearer`, the same
// seam /api/pint-drops/[id] and /p/[id] use. It only ever unredacts the
// viewer's OWN legacy rows; ?viewer= is the dev/test fallback and never unlocks
// anything in production (lib/pintDropViewer.ts).
//
// 200 { claims, entries, familyEntries } for a pub we hold, 404 for an id that
// is not one (or a pub that left the map), 503 for a read we could not run.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const read = await lookupVenueDetail(id);
  if (read.status === "unavailable") {
    return publicApiError("Ledger unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
  if (read.status !== "found") {
    return publicApiError("Venue not found.", "NOT_FOUND", 404);
  }
  const viewer = await resolveViewerContextFromRequest(
    request,
    new URL(request.url).searchParams.get("viewer"),
  );
  return jsonNoStore(await readLedgerLog(read.venue.id, read.venue.curation, viewer));
}
