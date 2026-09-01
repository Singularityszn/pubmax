import { jsonCached } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { getNightArea, isNightAreaRouteReady } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  if (!isNightAreaSlug(slug)) return publicApiError("We don't cover that area.", "NIGHT_AREA_NOT_FOUND", 404);
  const area = getNightArea(slug);
  // Same contract as the list one directory up: a Night Area is bundled config,
  // so this body is a pure function of the slug and the deploy. It reads no
  // store, no session and no viewer point, which is what makes a shared cache
  // honest here. Was no-store, for no reason its parent did not already answer.
  return jsonCached({ ...area, routeReady: isNightAreaRouteReady(area) });
}
