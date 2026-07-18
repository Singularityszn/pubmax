// GET /api/area-news — the fresh-facts layer for client surfaces.
//
//   ?area=<slug>      → { entries } — up to NEW_ROUND_HERE_CAP dated facts for a
//                        Night Area (or borough) slug, newest first. Powers the
//                        map's "New round here" block.
//   ?venueId=<id>     → { award }   — the award fact venue-matched to this pin,
//                        or null. Powers the venue sheet brass-plaque badge.
//
// Derived purely from the committed dataset (data/area_news.json), so it is safe
// to hold at the CDN edge (jsonCached). Never 500s: any failure degrades to an
// empty result, matching the layer's fail-soft contract.

import { publicApiError } from "@/lib/apiError";
import { jsonCached, jsonNoStore } from "@/lib/apiResponses";
import {
  awardForVenue,
  entriesForBorough,
  entriesForNightArea,
  loadAreaNews,
  NEW_ROUND_HERE_CAP,
} from "@/lib/areaNews";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const { entries } = await loadAreaNews();

    const venueId = params.get("venueId")?.trim();
    if (venueId) {
      return jsonCached({ award: awardForVenue(venueId, entries) });
    }

    const area = params.get("area")?.trim();
    if (area) {
      const nightArea = entriesForNightArea(area, entries);
      const resolved = nightArea.length ? nightArea : entriesForBorough(area, entries);
      return jsonCached({ entries: resolved.slice(0, NEW_ROUND_HERE_CAP) });
    }

    return publicApiError("Pass area or venueId.", "INVALID_REQUEST", 400);
  } catch {
    return jsonNoStore({ entries: [], award: null }, { status: 200 });
  }
}
