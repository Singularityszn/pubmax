// GET /api/harvest-overlay?venueId= — lazy website, menu, and cited lore
// for one OSM-identified venue, with its Google Places record and its OSM
// facts (lib/osmPubFacts.ts) beside it. Never rides in pin or slim payloads.
// A miss is unknown, not "no history". A failed read is degraded.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { mergePublicHarvestOverlays, toPublicOverlay } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { resolveHarvestOverlayVenue } from "@/lib/harvestOverlayVenue";
import { isLimited } from "@/lib/pintDrops";
import { osmFactsForOsmIds } from "@/lib/osmPubFacts.server";
import { placesRecordForVenue } from "@/lib/placesEnrichment.server";
import { clientIp, hashIp } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  // Per address only. A read route has no global budget: a shared 1,200 a
  // minute beside a per-address 120 let about ten addresses lock every other
  // reader out of a venue sheet. A miss here is a cheap indexed read, so the
  // per-address budget is the whole brake.
  const ipHash = hashIp(clientIp(request));
  if (await isLimited(`harvest-overlay:${ipHash}`, `harvest-overlay:${ipHash}`, 120)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const venueId = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!venueId) {
    return publicApiError("Add a venue id.", "INVALID_REQUEST", 400);
  }

  try {
    const resolution = await resolveHarvestOverlayVenue(venueId);
    const osmIds = resolution.status === "resolved" ? resolution.venueIds : [];
    const [placesContent, osmFacts] = await Promise.all([placesRecordForVenue(venueId, osmIds), osmFactsForOsmIds(osmIds)]);
    const sources = { ...(placesContent ? { placesContent } : {}), ...(osmFacts ? { osmFacts } : {}) };
    if (resolution.status === "unavailable") {
      return jsonNoStore({ status: "degraded", overlay: null, ...sources }, { status: 200 });
    }
    const reads =
      resolution.status === "resolved"
        ? await Promise.all(
            resolution.venueIds.map((osmId) =>
              harvestOverlayStore().getByVenueId(osmId),
            ),
          )
        : [{ status: "ready" as const, overlay: null }];
    if (reads.some((read) => read.status === "degraded")) {
      return jsonNoStore({ status: "degraded", overlay: null, ...sources }, { status: 200 });
    }
    const publicOverlays = reads.flatMap((read) =>
      read.status === "ready" && read.overlay ? [toPublicOverlay(read.overlay)] : [],
    );
    const overlay = mergePublicHarvestOverlays(publicOverlays);
    if (!overlay.website && !overlay.menuUrl && !overlay.lore) {
      return Response.json(
        { status: "ready", overlay: null, ...sources },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
      );
    }
    return Response.json(
      {
        status: "ready",
        overlay,
        ...sources,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return jsonNoStore({ status: "degraded", overlay: null }, { status: 200 });
  }
}
