// GET /api/nearby-bus-departures?lat=..&lng=..
//
// Pub-centred live bus departures using the same guarded TfL client as Last
// Pint. Stops stay within a walkable 500 m straight-line radius, and one
// combined Arrivals request keeps the keyless TfL fan-out and payload bounded.

import { CITIES, pointInCityBounds } from "@/lib/cities";
import { isLastRideLimited } from "@/lib/lastRideRateLimit";
import {
  BUS_ARRIVALS_TIMEOUT_MS,
  BUS_MIN_ATTEMPT_MS,
  BUS_ROUTE_BUDGET_MS,
  BUS_STOP_LOOKUP_TIMEOUT_MS,
  busUpstreamTimeoutMs,
  freshBusPredictions,
  type NearbyBusDeparturesResult,
  type NearbyBusStop,
  type TflBusPrediction,
} from "@/lib/nearbyBusDepartures";
import { tflGet } from "@/lib/tflClient.server";

export const runtime = "nodejs";
// Every upstream deadline below is drawn from this budget, so the route always
// reaches its own unavailable answer instead of being killed mid-call.
export const maxDuration = BUS_ROUTE_BUDGET_MS / 1000;

const STOP_RADIUS_M = 500;
const STOP_CAP = 4;
const DEPARTURES_PER_STOP = 3;
const STOP_TYPES = "NaptanPublicBusCoachTram";

type TflBusStop = {
  id?: string;
  naptanId?: string;
  commonName?: string;
  indicator?: string;
  towards?: string;
  distance?: number;
};

type TflBusStopResponse = {
  stopPoints?: TflBusStop[];
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function unavailable(now: Date): NearbyBusDeparturesResult {
  return {
    status: "unavailable",
    stops: [],
    generatedAt: now.toISOString(),
  };
}

function stopId(stop: TflBusStop): string {
  return (stop.naptanId ?? stop.id ?? "").trim();
}

function nearbyStops(response: TflBusStopResponse | null): TflBusStop[] {
  if (!Array.isArray(response?.stopPoints)) return [];
  return response.stopPoints
    .filter((stop) => {
      const distance = stop.distance;
      return (
        Boolean(stopId(stop)) &&
        typeof distance === "number" &&
        Number.isFinite(distance) &&
        distance >= 0 &&
        distance <= STOP_RADIUS_M
      );
    })
    .sort((a, b) => (a.distance as number) - (b.distance as number))
    .slice(0, STOP_CAP);
}

function stopResult(
  stop: TflBusStop,
  predictions: ReturnType<typeof freshBusPredictions>,
): NearbyBusStop | null {
  const id = stopId(stop);
  const departures = predictions
    .filter((prediction) => prediction.naptanId === id)
    .slice(0, DEPARTURES_PER_STOP)
    .map((prediction) => ({
      lineName: prediction.lineName,
      destinationName: prediction.destinationName,
      direction: prediction.direction,
      expectedArrival: prediction.expectedArrival,
    }));
  if (departures.length === 0) return null;

  return {
    id,
    name: stop.commonName?.trim() || "Bus stop",
    indicator: stop.indicator?.trim() || null,
    towards: stop.towards?.trim() || null,
    distanceM: Math.round(stop.distance as number),
    departures,
  };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const lat = Number.parseFloat(params.get("lat") ?? "");
  const lng = Number.parseFloat(params.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "lat and lng are required numbers." }, 400);
  }

  const now = new Date();
  if (!pointInCityBounds(lat, lng, CITIES.london)) {
    return json(unavailable(now));
  }
  if (await isLastRideLimited(request, "bus-departures")) {
    return json({ error: "Too many requests, slow down." }, 429);
  }

  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  const stopPath =
    `/StopPoint?lat=${lat}&lon=${lng}` +
    `&stopTypes=${STOP_TYPES}&radius=${STOP_RADIUS_M}&modes=bus`;
  // The arrivals call is held out of the stop lookup's deadline so a retried
  // lookup can never spend the whole budget and leave nothing to ask with.
  const stopLookup = (): Promise<TflBusStopResponse | null> => {
    const timeoutMs = busUpstreamTimeoutMs(
      BUS_STOP_LOOKUP_TIMEOUT_MS,
      elapsed(),
      BUS_MIN_ATTEMPT_MS,
    );
    if (timeoutMs < BUS_MIN_ATTEMPT_MS) return Promise.resolve(null);
    return tflGet<TflBusStopResponse>(stopPath, { timeoutMs });
  };

  const stops = nearbyStops((await stopLookup()) ?? (await stopLookup()));
  if (stops.length === 0) return json(unavailable(now));

  const arrivalsTimeoutMs = busUpstreamTimeoutMs(
    BUS_ARRIVALS_TIMEOUT_MS,
    elapsed(),
  );
  if (arrivalsTimeoutMs < BUS_MIN_ATTEMPT_MS) return json(unavailable(now));

  const ids = stops.map(stopId);
  const arrivals = await tflGet<TflBusPrediction[]>(
    `/StopPoint/${encodeURIComponent(ids.join(","))}/Arrivals`,
    { timeoutMs: arrivalsTimeoutMs },
  );
  if (!Array.isArray(arrivals)) return json(unavailable(now));

  const fresh = freshBusPredictions(arrivals, now);
  const stopResults = stops
    .map((stop) => stopResult(stop, fresh))
    .filter((stop): stop is NearbyBusStop => stop !== null);
  if (stopResults.length === 0) return json(unavailable(now));

  const result: NearbyBusDeparturesResult = {
    status: "ready",
    stops: stopResults,
    generatedAt: now.toISOString(),
  };
  return json(result);
}
