// GET /api/out?city=london&day=today|tomorrow|weekend
//
// Public Out read. Events half is L2 (loadWhatsOn as the current supply).
// Open plans come from list_open_social_crews with city and time window in the
// RPC so the fifty-row cap applies after the city filter. A failed plans read
// is degraded, never an empty market, and a degraded answer is never handed to
// the CDN.

import { publicApiError } from "@/lib/apiError";
import {
  boundOutEvents,
  boundOutOpenPlans,
  outPlansWindow,
  parseOutCity,
  parseOutDay,
  OUT_EVENT_LIMIT,
  OUT_OPEN_PLAN_LIMIT,
  OUT_UNAVAILABLE_ERROR,
  type OutResponse,
  type OutStatus,
} from "@/lib/out";
import { attachOpenPlanMeetingPoints } from "@/lib/openSocialCrew.server";
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
  const window = outPlansWindow(day, now);

  let status: OutStatus = "ready";
  let openPlans: OutResponse["openPlans"] = [];
  try {
    const listed = await store.listOpen({
      from: window.from,
      until: window.until,
      city,
      limit: OUT_OPEN_PLAN_LIMIT,
    });
    const attached = await attachOpenPlanMeetingPoints(listed);
    if (attached.status === "degraded") status = "degraded";
    openPlans = boundOutOpenPlans(attached.plans);
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
  } catch {
    return publicApiError(OUT_UNAVAILABLE_ERROR, "out_unavailable", 200, {
      retryable: true,
      compatibilityFields: { ...DEGRADED_FIELDS, openPlans },
    });
  }
}
