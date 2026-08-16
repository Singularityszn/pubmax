// Crowd occupancy for one venue (master plan R-011).
//
// GET is public and fail-soft: a broken read is `degraded`, never "no reports".
// POST is signed-in, rate-limited, and idempotent per account per pub per
// 15 minutes. Trust is derived on read. The browser never touches the table.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { occupancyNowFromReports, parseOccupancyLevel } from "@/lib/occupancy";
import { occupancyStore } from "@/lib/occupancyStore";
import { isLimited } from "@/lib/pintDrops";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

type RouteContext = { params: Promise<{ id: string }> };

function venueIdFrom(raw: string): string {
  return raw.trim().slice(0, 64);
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: rawId } = await context.params;
  const venueId = venueIdFrom(rawId);
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }
  try {
    const reading = await occupancyStore().readNow(venueId);
    return jsonNoStore({
      now: reading.now,
      ageMinutes: reading.ageMinutes,
      reportsLast90: reading.reportsLast90,
      degraded: reading.degraded,
      state: reading.state,
    });
  } catch {
    const failed = occupancyNowFromReports([], Date.now(), { degraded: true });
    return jsonNoStore({
      now: failed.now,
      ageMinutes: failed.ageMinutes,
      reportsLast90: failed.reportsLast90,
      degraded: true,
      state: "degraded",
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { id: rawId } = await context.params;
  const venueId = venueIdFrom(rawId);
  if (!venueId) {
    return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  }

  const userId = await callerUserId(request);
  if (!userId) {
    return publicApiError("Sign in to report how busy it is.", "UNAUTHENTICATED", 401);
  }

  const key = `venue-occupancy:${userId}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const level = parseOccupancyLevel(body.level);
  if (!level) {
    return publicApiError(
      "Choose empty, some seats, or full.",
      "INVALID_REQUEST",
      400,
    );
  }

  try {
    const stored = await occupancyStore().report({
      venueId,
      level,
      reporterUserId: userId,
    });
    const reading = await occupancyStore().readNow(venueId);
    return jsonNoStore({
      now: reading.now,
      ageMinutes: reading.ageMinutes,
      reportsLast90: reading.reportsLast90,
      degraded: reading.degraded,
      state: reading.state,
      level: stored.level,
    });
  } catch {
    return publicApiError(
      "We could not save that just now. Try again.",
      "UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}
