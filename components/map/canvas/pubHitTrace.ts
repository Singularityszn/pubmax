import type * as maplibregl from "maplibre-gl";

const MAX_PROBE_POINTS = 64;
const MAX_CLICK_EVENTS = 4;
const MAX_HITS = 32;

type Point = { x: number; y: number };
type Camera = {
  bearing: number;
  pitch: number;
  zoom: number;
  center: [number, number];
  moving: boolean;
  settling: boolean;
};
type Context = {
  observedAt: number;
  camera: Camera | null;
  url: string;
  selectedVenueId: string | null;
  historyLength: number;
};
type HitStack = {
  point: Point;
  viewportPoint: Point | null;
  winnerId: string | null;
  hitCount: number;
  hits: { layer: string | null; venueId: string | null }[];
};
type ClickReading = Context & HitStack & {
  probeSequence: number;
  probeContext: Context | null;
  probePoints: HitStack[];
  omittedProbePoints: number;
};

let enabled = false;
let sequence = 0;
let probeContext: Context | null = null;
let probePoints: HitStack[] = [];
let clicks: ClickReading[] = [];
let omittedProbePoints = 0;
let omittedClickEvents = 0;

function venueId(value: unknown): string | null {
  return typeof value === "string" && /^venue-[a-z0-9-]{1,120}$/i.test(value)
    ? value
    : null;
}

function context(): Context {
  const probeWindow = window as Window & {
    __pubmaxMapCamera?: { read: () => Camera };
  };
  const route = new URL(location.href);
  const selectedVenueId = venueId(route.searchParams.get("sel"));
  return {
    observedAt: performance.now(),
    camera: probeWindow.__pubmaxMapCamera?.read() ?? null,
    // Record the public selection route, never an ask or account query value.
    url: `${route.origin}${route.pathname}${selectedVenueId ? `?sel=${selectedVenueId}` : ""}`,
    selectedVenueId,
    historyLength: history.length,
  };
}

function hitStack(
  point: Point,
  hits: readonly maplibregl.MapGeoJSONFeature[],
  winner: maplibregl.MapGeoJSONFeature | undefined,
  viewportPoint: Point | null,
): HitStack {
  return {
    point: { x: point.x, y: point.y },
    viewportPoint,
    winnerId: venueId(winner?.properties?.id),
    hitCount: hits.length,
    hits: hits.slice(0, MAX_HITS).map((hit) => ({
      layer: typeof hit.layer?.id === "string" ? hit.layer.id.slice(0, 80) : null,
      venueId: venueId(hit.properties?.id),
    })),
  };
}

/** Opt-in diagnostic attached only to the existing painted-map QA probe. */
export const pubHitTrace = {
  start() {
    enabled = true;
    sequence = 0;
    probeContext = null;
    probePoints = [];
    clicks = [];
    omittedProbePoints = 0;
    omittedClickEvents = 0;
  },
  stop() { enabled = false; },
  read() {
    return { enabled, sequence, probeContext, probePoints, clicks, omittedProbePoints, omittedClickEvents };
  },
};

export function beginPubHitProbeTrace() {
  if (!enabled) return;
  sequence += 1;
  probeContext = null;
  probePoints = [];
  omittedProbePoints = 0;
}

/** Records the camera and route after the existing probe has collected points. */
export function finishPubHitProbeTrace() {
  if (!enabled) return;
  probeContext = context();
}

/** Reuses the point query already made by the painted probe. */
export function recordPubHitProbe(
  point: Point,
  hits: readonly maplibregl.MapGeoJSONFeature[],
  winner: maplibregl.MapGeoJSONFeature | undefined,
  viewportPoint: Point,
) {
  if (!enabled) return;
  if (probePoints.length >= MAX_PROBE_POINTS) { omittedProbePoints += 1; return; }
  probePoints.push(hitStack(point, hits, winner, viewportPoint));
}

/** Reuses the real router's already queried features and resolved pub winner. */
export function recordPubHitClick(
  point: Point,
  hits: readonly maplibregl.MapGeoJSONFeature[],
  winner: maplibregl.MapGeoJSONFeature | undefined,
) {
  if (!enabled) return;
  if (clicks.length >= MAX_CLICK_EVENTS) { omittedClickEvents += 1; return; }
  clicks.push({
    ...context(),
    ...hitStack(point, hits, winner, null),
    probeSequence: sequence,
    probeContext,
    probePoints: [...probePoints],
    omittedProbePoints,
  });
}
