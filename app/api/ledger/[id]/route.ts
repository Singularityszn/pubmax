import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { readLedgerLog } from "@/lib/ledgerLog.server";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { assertServerEnv } from "@/lib/serverEnv";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";

assertServerEnv();

// Contributions use a separate no-store read under the cache contract in
// docs/rules/app-proxy-csp-caching-and-file-tracing.md.
//
// The viewer is the JWT the client sends as `Authorization: Bearer`, the same
// seam /api/pint-drops/[id] and /p/[id] use. It only ever unredacts the
// viewer's OWN legacy rows; ?viewer= is the dev/test fallback and never unlocks
// anything in production (lib/pintDropViewer.ts).
//
// The response shape is LedgerLog in lib/ledgerLog.server.ts. An unknown pub
// returns 404. A venue or logbook read that cannot complete returns 503.

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
  try {
    return jsonNoStore(await readLedgerLog(read.venue.id, read.venue.curation, viewer));
  } catch {
    // A Pint Drop store we could not read is an answer we do not have, never
    // an empty logbook: the same retryable envelope as a venue read that failed.
    return publicApiError("Ledger unavailable.", "UNAVAILABLE", 503, { retryable: true });
  }
}
