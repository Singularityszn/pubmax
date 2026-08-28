// GET /api/area-news — the fresh-facts layer for client surfaces.
//
//   ?area=<slug>      → { entries } — up to NEW_ROUND_HERE_CAP dated facts for a
//                        Night Area (or borough) slug, newest first. Powers the
//                        map's "New round here" block.
//   ?venueId=<id>     → { award }   — the award fact venue-matched to this pin,
//                        or null. Powers the venue sheet brass-plaque badge.
//
// Derived purely from committed dataset (data/area_news.json). Successful reads
// are edge-cacheable. Read failures are no-store and keep unavailable distinct
// from a successful empty result.

import { publicApiError } from "@/lib/apiError";
import { jsonCached, jsonNoStore } from "@/lib/apiResponses";
import {
  awardForVenue,
  entriesForBorough,
  entriesForNightArea,
  freshAreaNews,
  NEW_ROUND_HERE_CAP,
} from "@/lib/areaNews";
import { loadAreaNews } from "@/lib/areaNews.server";

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const venueId = params.get("venueId")?.trim();
    const area = params.get("area")?.trim();
    if (!venueId && !area) return publicApiError("Pass area or venueId.", "INVALID_REQUEST", 400);

    const loaded = await loadAreaNews();
    if (loaded.status === "unavailable") {
      return jsonNoStore({ status: "unavailable", entries: [], award: null }, { status: 200 });
    }

    const { entries } = loaded;
    if (venueId) {
      return jsonCached({ status: "ready", award: awardForVenue(venueId, freshAreaNews(entries)) });
    }

    if (area) {
      const freshEntries = freshAreaNews(entries);
      const nightArea = entriesForNightArea(area, freshEntries);
      const resolved = nightArea.length ? nightArea : entriesForBorough(area, freshEntries);
      return jsonCached({ status: "ready", entries: resolved.slice(0, NEW_ROUND_HERE_CAP) });
    }

    return publicApiError("Pass area or venueId.", "INVALID_REQUEST", 400);
  } catch {
    return jsonNoStore({ status: "unavailable", entries: [], award: null }, { status: 200 });
  }
}
