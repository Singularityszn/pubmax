import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { boundedJson, RequestBodyTooLargeError } from "@/lib/boundedRequest.server";
import { isLimited } from "@/lib/pintDrops";
import { parseComparisonVenueIds, parsePubComparisonRequest } from "@/lib/pubComparison";
import { loadPubComparison, loadPubComparisonCatalogue, PubComparisonReadError } from "@/lib/pubComparison.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";

assertServerEnv();
export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 8 * 1024;

async function limited(request: Request): Promise<boolean> {
  const key = `pub-comparison:${hashIp(clientIp(request))}`;
  return isLimited(key, key, 20, 60_000);
}
function failure(error: unknown): Response {
  if (error instanceof PubComparisonReadError) {
    return publicApiError(error.message, error.status === 400 ? "INVALID_REQUEST" : error.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", error.status, {
      retryable: error.status === 503, headers: PRIVATE_HEADERS,
    });
  }
  return publicApiError("Could not read pub prices just now.", "UNAVAILABLE", 503, { retryable: true, headers: PRIVATE_HEADERS });
}
function rateLimitResponse(): Response {
  return publicApiError("Too many comparisons. Try again shortly.", "RATE_LIMITED", 429, { retryable: true, headers: PRIVATE_HEADERS });
}

/** Public catalogue records only. Shortlist-specific responses are never cached. */
export async function GET(request: Request): Promise<Response> {
  try {
    if (await limited(request)) return rateLimitResponse();
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== "venues") || url.searchParams.getAll("venues").length > 1) {
      return publicApiError("Select up to three pubs.", "INVALID_REQUEST", 400, { headers: PRIVATE_HEADERS });
    }
    const raw = url.searchParams.get("venues");
    const ids = parseComparisonVenueIds(raw ? raw.split(",") : [], true);
    if (!ids) return publicApiError("Select up to three different pubs.", "INVALID_REQUEST", 400, { headers: PRIVATE_HEADERS });
    return jsonNoStore(await loadPubComparisonCatalogue(ids), { headers: PRIVATE_HEADERS });
  } catch (error) { return failure(error); }
}

/** This calculates a comparison. It does not create a plan, Round, vote, or price report. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (await limited(request)) return rateLimitResponse();
    if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return publicApiError("Send the comparison as JSON.", "INVALID_REQUEST", 415, { headers: PRIVATE_HEADERS });
    }
    let body: unknown;
    try { body = await boundedJson(request, MAX_BODY_BYTES); }
    catch (error) {
      return publicApiError(error instanceof RequestBodyTooLargeError ? "The comparison is too large." : "The comparison could not be read.",
        error instanceof RequestBodyTooLargeError ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST",
        error instanceof RequestBodyTooLargeError ? 413 : 400, { headers: PRIVATE_HEADERS });
    }
    const input = parsePubComparisonRequest(body);
    if (!input) return publicApiError("Select up to three pubs and check the drinks, servings and quantities.", "INVALID_REQUEST", 400, { headers: PRIVATE_HEADERS });
    return jsonNoStore(await loadPubComparison(input, request.signal), { headers: PRIVATE_HEADERS });
  } catch (error) { return failure(error); }
}
