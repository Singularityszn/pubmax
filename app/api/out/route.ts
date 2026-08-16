// GET /api/out?city=london&day=today|tomorrow|weekend
//
// Public Out read. Events half is L2 (loadWhatsOn as the current supply).
// Open plans come from list_open_social_crews, narrowed to the asked-for city
// by resolving each plan's Stop 1 (lib/openSocialCrew.server) - plans store no
// city of their own. A failed plans read is degraded, never an empty market,
// and a degraded answer is never handed to the CDN.

import { publicApiError } from "@/lib/apiError";
import {
  boundOutEvents,
  boundOutOpenPlans,
  outPlansFromIso,
  parseOutCity,
  parseOutDay,
  OUT_EVENT_LIMIT,
  OUT_OPEN_PLAN_LIMIT,
  type OutResponse,
  type OutStatus,
} from "@/lib/out";
import { openPlansInCity } from "@/lib/openSocialCrew.server";
import { isOutLimited } from "@/lib/outRateLimit";
import { createSocialCrewStore } from "@/lib/socialCrewStore";
import { loadWhatsOn } from "@/lib/whatsOnStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_MAX_AGE_S = 300;
const CACHE_STALE_WHILE_REVALIDATE_S = 900;

const store = createSocialCrewStore();

const DEGRADED_FIELDS = {
  status: "degraded",
  events: [],
  openPlans: [],
  attribution: [],
  kindObservedAt: {},
} as const;

function jsonResponse(body: OutResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Only a ready answer is edge-cacheable. A degraded one would pin an
      // empty market at the CDN for the whole window.
      "cache-control": body.status === "ready"
        ? `public, s-maxage=${CACHE_MAX_AGE_S}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_S}`
        : "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  if (await isOutLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
      compatibilityFields: { ...DEGRADED_FIELDS },
    });
  }

  const params = new URL(request.url).searchParams;
  const city = parseOutCity(params.get("city"));
  const day = parseOutDay(params.get("day"));
  const now = Date.now();

  let status: OutStatus = "ready";
  let openPlans: OutResponse["openPlans"] = [];
  try {
    const listed = await store.listOpen({
      from: outPlansFromIso(day, now),
      limit: OUT_OPEN_PLAN_LIMIT,
    });
    const inCity = await openPlansInCity(listed, city);
    if (inCity.status === "degraded") status = "degraded";
    openPlans = boundOutOpenPlans(inCity.plans);
  } catch {
    status = "degraded";
    openPlans = [];
  }

  try {
    const events = await loadWhatsOn({ limit: OUT_EVENT_LIMIT }, { now });
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
      compatibilityFields: { ...DEGRADED_FIELDS, openPlans },
    });
  }
}
