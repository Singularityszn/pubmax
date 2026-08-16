// GET /api/out?city=london&day=today|tomorrow|weekend
//
// Public Out listing. Bundled events file plus a request-time Ticketmaster /
// Skiddle supplement. A missing key is not-configured. A configured provider
// that fails is degraded and still returns the bundled rows. Never an empty
// market claim.

import { publicApiError } from "@/lib/apiError";
import { buildOutResponse, parseOutQuery } from "@/lib/out/loadOut";
import { isOutLimited } from "@/lib/outRateLimit";
import { withRouteTiming } from "@/lib/routeObservability";

export const runtime = "nodejs";
export const maxDuration = 15;

const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=900";

export const GET = withRouteTiming("out", getHandler);

async function getHandler(request: Request): Promise<Response> {
  if (await isOutLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const url = new URL(request.url);
  const query = parseOutQuery(url.searchParams);
  if (!query) {
    return publicApiError("Unknown city or day.", "INVALID_REQUEST", 400);
  }

  const body = await buildOutResponse(query);
  return Response.json(body, {
    headers: { "cache-control": CACHE_CONTROL },
  });
}
