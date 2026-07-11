// GET /api/citymcp/area?borough=<name>
//
// Thin CityMCP London `get_area` proxy, scoped to the borough pint-price
// card on /borough/[slug]. Fail-soft: any upstream failure (or a missing
// `borough` param) surfaces as a 200 with nulls — never a hard 500 — so the
// card can quietly not render rather than break the page.

import { jsonNoStore } from "@/lib/apiResponses";
import { fetchCityArea } from "@/lib/citymcp/area";
import { CityMcpError } from "@/lib/citymcp/client";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BOROUGH_LEN = 60;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const borough = params.get("borough")?.trim();

  if (!borough || borough.length > MAX_BOROUGH_LEN) {
    return jsonNoStore({
      borough: null,
      averagePintGbp: null,
      asOf: null,
      error: "borough is required.",
    });
  }

  try {
    const area = await fetchCityArea(borough);
    return jsonNoStore(area);
  } catch (err) {
    const message =
      err instanceof CityMcpError ? err.message : "CityMCP request failed";
    return jsonNoStore({
      borough,
      averagePintGbp: null,
      asOf: null,
      error: message,
    });
  }
}
