// GET /api/last-merseyrail?lat=..&lng=..  →  LastRideResult (Merseyrail)
//
// Liverpool sibling to /api/last-tram. Uses bundled Merseyrail stops + a
// conservative typical last-service schedule (static). Never scrapes
// Merseytravel. Same response shape as LastTrainResult so LastTrainCard can
// share UI.
//
// Robustness: NEVER 500s — bad coords → 400; empty seed / unexpected errors →
// 200 with an error string the card can show gracefully.

import { promises as fs } from "fs";
import path from "path";

import { haversineKm } from "@/lib/haversine";
import {
  computeMerseyrailLastRide,
  MERSEYRAIL_PROVENANCE,
  nearestMerseyrailStation,
} from "@/lib/merseyrail";
import type { NearestPub } from "@/lib/tfl";

export const runtime = "nodejs";

const NEAREST_PUB_COUNT = 3;

type SlimVenueRow = {
  id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  cheapestPrice?: number | null;
};

let cachedSlim: SlimVenueRow[] | null = null;

async function liverpoolSlimVenues(): Promise<SlimVenueRow[]> {
  if (cachedSlim) return cachedSlim;
  try {
    const file = path.join(
      process.cwd(),
      "public",
      "data",
      "cities",
      "liverpool",
      "venues_slim.json",
    );
    const rows = JSON.parse(await fs.readFile(file, "utf8")) as SlimVenueRow[];
    cachedSlim = Array.isArray(rows) ? rows : [];
  } catch {
    cachedSlim = [];
  }
  return cachedSlim;
}

async function nearestPubsToStation(
  stationLat: number,
  stationLng: number,
): Promise<NearestPub[]> {
  const venues = await liverpoolSlimVenues();
  const withDistance = venues
    .filter(
      (v) =>
        typeof v.id === "string" &&
        typeof v.name === "string" &&
        Number.isFinite(v.lat) &&
        Number.isFinite(v.lng),
    )
    .map((v) => ({
      v,
      km: haversineKm([stationLng, stationLat], [v.lng as number, v.lat as number]),
    }));
  withDistance.sort((a, b) => a.km - b.km);
  return withDistance.slice(0, NEAREST_PUB_COUNT).map(({ v }) => ({
    id: v.id as string,
    name: v.name as string,
    price: typeof v.cheapestPrice === "number" ? v.cheapestPrice : null,
  }));
}

function json(body: unknown, opts: { status?: number; cache?: boolean } = {}): Response {
  const { status = 200, cache = false } = opts;
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Static timetable answers can sit briefly at the edge; decision leave-by
      // still ticks with wall clock, so keep TTL short.
      "cache-control": cache
        ? "public, s-maxage=300, stale-while-revalidate=3600"
        : "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const lat = Number.parseFloat(params.get("lat") ?? "");
    const lng = Number.parseFloat(params.get("lng") ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return json({ error: "lat and lng are required numbers." }, { status: 400 });
    }

    // Destination is client-only — ignore any legacy ?destination= query.
    const nearest = nearestMerseyrailStation(lat, lng);
    const nearestPubs = nearest
      ? await nearestPubsToStation(nearest.lat, nearest.lng).catch(() => [] as NearestPub[])
      : [];

    const result = computeMerseyrailLastRide({
      lat,
      lng,
      nearestPubs,
    });

    if (!result.station?.id) {
      return json(
        {
          ...result,
          station: null,
          error: result.error ?? "Couldn't resolve a Merseyrail stop nearby.",
          provenance: result.provenance ?? MERSEYRAIL_PROVENANCE,
        },
        { cache: false },
      );
    }

    const body = {
      ...result,
      decision: result.decision
        ? { ...result.decision, destinationLabel: null }
        : result.decision,
    };

    // Static typical schedule — cacheable briefly when we have trains.
    return json(body, { cache: (body.trains?.length ?? 0) > 0 });
  } catch {
    return json(
      {
        error: "Couldn't check Merseyrail just now — check before you head out.",
        station: null,
        trains: [],
        departures: [],
        nearestPubs: [],
        generatedAt: new Date().toISOString(),
        provider: "merseyrail",
        modeLabel: "train",
        provenance: MERSEYRAIL_PROVENANCE,
        staticFallback: true,
      },
      { cache: false },
    );
  }
}
