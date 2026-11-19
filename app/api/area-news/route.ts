// GET /api/area-news — the fresh-facts layer for client surfaces.
//
//   ?area=<slug>      → { entries } — up to NEW_ROUND_HERE_CAP dated facts for a
//                        Night Area (or borough) slug, newest first. Powers the
//                        map's "New round here" block.
//   ?venueId=<id>     → { award }   — the award fact venue-matched to this pin,
//                        or null. Powers the venue sheet brass-plaque badge.
//
// Derived purely from committed dataset (data/area_news.json). Successful and
// unavailable read states remain distinct.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  areaNewsLaneCovers,
  awardForVenue,
  entriesForBorough,
  entriesForNightArea,
  freshAreaNews,
  isKnownAreaSlug,
  NEW_ROUND_HERE_CAP,
} from "@/lib/areaNews";
import { loadAreaNews } from "@/lib/areaNews.server";
import { DAY_MS } from "@/lib/dayMs";

function readyResponse(body: Record<string, unknown>, now: number): Response {
  // Facts enter or leave the freshness window at UTC midnight.
  const secondsUntilMidnight = Math.floor((DAY_MS - (now % DAY_MS)) / 1000);
  const maxAge = Math.min(60, secondsUntilMidnight);
  return Response.json({ status: "ready", ...body }, {
    headers: { "Cache-Control": `private, max-age=${maxAge}, must-revalidate` },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const venueId = params.get("venueId")?.trim();
    const area = params.get("area")?.trim();
    if (!venueId && !area) return publicApiError("Pass area or venueId.", "INVALID_REQUEST", 400);
    if (area && !venueId) {
      if (!isKnownAreaSlug(area)) {
        return publicApiError("Unknown area.", "INVALID_REQUEST", 400);
      }
      // A real place the join table cannot reach. We hold no lane for it, so the
      // honest answer is that we could not look, never an empty list.
      if (!areaNewsLaneCovers(area)) {
        return jsonNoStore({ status: "unavailable", entries: [], award: null }, { status: 200 });
      }
    }

    const loaded = await loadAreaNews();
    if (loaded.status === "unavailable") {
      return jsonNoStore({ status: "unavailable", entries: [], award: null }, { status: 200 });
    }

    const now = Date.now();
    const freshEntries = freshAreaNews(loaded.entries, { now });
    if (venueId) {
      return readyResponse({ award: awardForVenue(venueId, freshEntries) }, now);
    }

    if (area) {
      const nightArea = entriesForNightArea(area, freshEntries);
      const resolved = nightArea.length ? nightArea : entriesForBorough(area, freshEntries);
      return readyResponse({ entries: resolved.slice(0, NEW_ROUND_HERE_CAP) }, now);
    }

    return publicApiError("Pass area or venueId.", "INVALID_REQUEST", 400);
  } catch {
    return jsonNoStore({ status: "unavailable", entries: [], award: null }, { status: 200 });
  }
}
