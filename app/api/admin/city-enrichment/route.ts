// City enrichment checkpoint, on the moderator door.
//   GET  → { durable, cities: CityEnrichmentHealth[] }
//   POST { action: "requeue", city, osmIds? } → { ok, requeued }
//
// This is where a partial run is inspectable: how far each city has got, which
// venues are owed a bounded retry and when, and which the attempt cap refused.
// The refused list is the reason POST exists - a terminal failure is recorded
// WITH a way back, and this is that way.
//
// Token-gated like every other /api/admin route, because the row carries
// provider error text and the shape of our own spend. Migration 0142 grants
// the browser nothing at all.

import { isModerator } from "@/lib/adminAuth";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";
import { clientIp, hashIp } from "@/lib/supabase";
import {
  ENRICHMENT_CITIES,
  MAX_VENUE_ATTEMPTS,
  RETRY_QUERY_BUDGET,
  readCityEnrichmentHealth,
  requeueCityEnrichmentTerminals,
} from "@/lib/tavilyPubEnrichment.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function forbidden(): Response {
  return publicApiError("Not authorised.", "FORBIDDEN", 403);
}

/** Same per-IP budget the other moderator doors spend. */
async function rateLimited(request: Request): Promise<Response | null> {
  const ipKey = hashIp(clientIp(request));
  if (await isLimited(`admin-city-enrichment:${ipKey}`, `admin-city-enrichment:${ipKey}`)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  const limited = await rateLimited(request);
  if (limited) return limited;

  const report = await readCityEnrichmentHealth();
  return jsonNoStore({
    durable: report.durable,
    maxVenueAttempts: MAX_VENUE_ATTEMPTS,
    retryQueryBudget: RETRY_QUERY_BUDGET,
    cities: report.cities,
  });
}

export async function POST(request: Request): Promise<Response> {
  assertServerEnv();
  if (!isModerator(request)) return forbidden();
  const limited = await rateLimited(request);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  if (body.action !== "requeue") {
    return publicApiError("Unsupported action.", "INVALID_REQUEST", 400);
  }
  const city = typeof body.city === "string" ? body.city.trim().toLowerCase() : "";
  if (!ENRICHMENT_CITIES.includes(city)) {
    return publicApiError("Unknown enrichment city.", "INVALID_REQUEST", 400);
  }
  const osmIds = Array.isArray(body.osmIds)
    ? body.osmIds.filter(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      )
    : undefined;

  const result = await requeueCityEnrichmentTerminals(city, { osmIds });
  if (!result.ok) {
    // A write we could not run is reported as one. Answering ok over a
    // checkpoint that never moved would leave the venues refused in silence.
    return publicApiError(
      "City enrichment checkpoint unavailable.",
      "CHECKPOINT_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  return jsonNoStore({ ok: true, city, requeued: result.requeued });
}
