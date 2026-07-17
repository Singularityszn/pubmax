import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { parseCityId } from "@/lib/cities";
import { getNightAreasForCity, isNightAreaRouteReady } from "@/lib/nightAreas";

export async function GET(request: Request): Promise<Response> {
  const cityId = parseCityId(new URL(request.url).searchParams.get("city"));
  if (!cityId) return publicApiError("city is required and must be valid.", "CITY_INVALID", 400);
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return publicApiError("Night Areas are not available for this city yet.", "NIGHT_AREAS_NOT_FOUND", 404);
  return jsonNoStore({
    cityId,
    areas: areas.map((area) => ({ ...area, routeReady: isNightAreaRouteReady(area) })),
  });
}
