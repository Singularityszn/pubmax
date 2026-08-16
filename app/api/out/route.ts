// GET /api/out?city=london&day=today|tomorrow|weekend
//
// Public Out read. Events half is L2 (loadWhatsOn as the current supply).
// Open plans come from list_open_social_crews. A failed plans read is
// degraded, never an empty market.

import { publicApiError } from "@/lib/apiError";
import {
  boundOutEvents,
  boundOutOpenPlans,
  outPlansFromIso,
  parseOutCity,
  parseOutDay,
  type OutResponse,
  type OutStatus,
} from "@/lib/out";
import { createSocialCrewStore } from "@/lib/socialCrewStore";
import { loadWhatsOn } from "@/lib/whatsOnStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 900;

const store = createSocialCrewStore();

function jsonResponse(body: OutResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const city = parseOutCity(params.get("city"));
  const day = parseOutDay(params.get("day"));
  const now = Date.now();

  let status: OutStatus = "ready";
  let openPlans: OutResponse["openPlans"] = [];
  try {
    openPlans = boundOutOpenPlans(
      await store.listOpen({
        city,
        from: outPlansFromIso(day, now),
        limit: 50,
      }),
    );
  } catch {
    status = "degraded";
    openPlans = [];
  }

  try {
    const events = await loadWhatsOn({ limit: 100 }, { now });
    return jsonResponse({
      status,
      events: boundOutEvents(events.rows),
      openPlans,
      attribution: [],
      kindObservedAt: events.kindObservedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "out request failed";
    return publicApiError(message, "out_unavailable", 200, {
      retryable: true,
      compatibilityFields: {
        status: "degraded",
        events: [],
        openPlans,
        attribution: [],
        kindObservedAt: {},
      },
    });
  }
}
