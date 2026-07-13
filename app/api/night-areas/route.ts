import { jsonNoStore } from "@/lib/apiResponses";
import { parseCityId } from "@/lib/cities";
import { getNightAreasForCity, isNightAreaRouteReady } from "@/lib/nightAreas";

export async function GET(request: Request): Promise<Response> {
  const cityId = parseCityId(new URL(request.url).searchParams.get("city"));
  if (!cityId) return jsonNoStore({ error: "city is required and must be valid." }, { status: 400 });
  const areas = getNightAreasForCity(cityId);
  if (areas.length === 0) return jsonNoStore({ error: "Night Areas are not available for this city yet." }, { status: 404 });
  return jsonNoStore({
    cityId,
    areas: areas.map((area) => ({ ...area, routeReady: isNightAreaRouteReady(area) })),
  });
}
