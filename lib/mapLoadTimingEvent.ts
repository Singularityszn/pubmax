// The closed shape of the one field-timing event a map visit sends through the
// PostHog browser SDK. It is a leaf with no imports so the SDK's before_send
// (lib/posthogClient.ts) and the reporter (lib/mapLoadTiming.ts) read one rule.
//
// Every milestone is milliseconds from navigation start (the performance
// timeline's time origin), so a p99 across real visitors reads the same clock
// the local `pubmax:*` marks use. No value here can carry free text, a URL, a
// handle or a location: enums are closed, numbers are clamped integers.

export const MAP_LOAD_TIMING_EVENT = "map_load_timing";

/** Pins that have not painted this long after the map mounted are the tail. */
export const MAP_LOAD_TIMEOUT_MS = 30_000;

const MAP_LOAD_OUTCOMES = ["painted", "timeout", "abandoned"] as const;
export type MapLoadOutcome = (typeof MAP_LOAD_OUTCOMES)[number];

export const MAP_LOAD_NAV_TYPES = [
  "navigate",
  "reload",
  "back_forward",
  "prerender",
  "unknown",
] as const;
export type MapLoadNavType = (typeof MAP_LOAD_NAV_TYPES)[number];

const MAP_LOAD_DEVICE_CLASSES = ["phone", "tablet", "desktop"] as const;
export type MapLoadDeviceClass = (typeof MAP_LOAD_DEVICE_CLASSES)[number];

export const MAP_LOAD_EFFECTIVE_TYPES = ["slow-2g", "2g", "3g", "4g", "unknown"] as const;
export type MapLoadEffectiveType = (typeof MAP_LOAD_EFFECTIVE_TYPES)[number];

/** navigator.deviceMemory is already bucketed by the browser to these. */
const DEVICE_MEMORY_BUCKETS = new Set([0.25, 0.5, 1, 2, 4, 8, 16, 32]);

/** The milestone properties, each the first matching mark of this visit. */
export const MAP_LOAD_MILESTONES = {
  map_constructed_ms: "pubmax:map-constructed",
  scene_built_ms: "pubmax:map-scene-built",
  first_pins_ms: "pubmax:first-pins",
  pins_visible_ms: "pubmax:pins-visible",
} as const;
export type MapLoadMilestone = keyof typeof MAP_LOAD_MILESTONES;

/**
 * Every value is a point on the document's clock, not a duration, so a map
 * opened late in a long-lived tab still reports. A day is the stuck-clock cap.
 */
const MAX_TIMING_MS = 86_400_000;
const MAX_VIEWPORT_PX = 10_000;
const MAX_VENUE_COUNT = 200_000;
const MAX_HARDWARE_CONCURRENCY = 256;
const MAX_SURFACE_LENGTH = 64;

export type MapLoadTimingProps = {
  outcome: MapLoadOutcome;
  surface: string;
  landed_on_map: boolean;
  mount_ms: number;
  elapsed_ms: number;
  nav_type: MapLoadNavType;
  sw_controlled: boolean;
  returning_visit: boolean;
  hidden_before_pins: boolean;
  device_class: MapLoadDeviceClass;
  mobile: boolean;
  viewport_width: number;
  viewport_height: number;
  effective_type: MapLoadEffectiveType;
  venue_count: number;
  save_data?: boolean;
  device_memory?: number;
  hardware_concurrency?: number;
} & Partial<Record<MapLoadMilestone, number>>;

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function boundedInt(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    return null;
  }
  return Math.round(value);
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The surface a map mounted on that the closed pageview list does not name. */
export const MAP_LOAD_OTHER_SURFACE = "other";

/** A coarse pageview surface such as `/map` or `/city/[city]`; never a raw path. */
function safeSurface(value: unknown): string | null {
  if (value === MAP_LOAD_OTHER_SURFACE) return value;
  return typeof value === "string"
    && value.startsWith("/")
    && value.length <= MAX_SURFACE_LENGTH
    && /^[a-z0-9/[\]_-]+$/.test(value)
    ? value
    : null;
}

/**
 * Rebuild the event properties from an untrusted bag. Returns null when a
 * required field is missing or out of its closed set, and drops any optional
 * field that does not pass, so nothing outside this shape can leave.
 */
export function sanitizeMapLoadTimingProps(raw: unknown): MapLoadTimingProps | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const outcome = oneOf(MAP_LOAD_OUTCOMES, input.outcome);
  const surface = safeSurface(input.surface);
  const landedOnMap = bool(input.landed_on_map);
  const mountMs = boundedInt(input.mount_ms, MAX_TIMING_MS);
  const elapsedMs = boundedInt(input.elapsed_ms, MAX_TIMING_MS);
  const navType = oneOf(MAP_LOAD_NAV_TYPES, input.nav_type);
  const swControlled = bool(input.sw_controlled);
  const returningVisit = bool(input.returning_visit);
  const hiddenBeforePins = bool(input.hidden_before_pins);
  const deviceClass = oneOf(MAP_LOAD_DEVICE_CLASSES, input.device_class);
  const mobile = bool(input.mobile);
  const viewportWidth = boundedInt(input.viewport_width, MAX_VIEWPORT_PX);
  const viewportHeight = boundedInt(input.viewport_height, MAX_VIEWPORT_PX);
  const effectiveType = oneOf(MAP_LOAD_EFFECTIVE_TYPES, input.effective_type);
  const venueCount = boundedInt(input.venue_count, MAX_VENUE_COUNT);
  if (
    outcome === null
    || surface === null
    || landedOnMap === null
    || mountMs === null
    || elapsedMs === null
    || navType === null
    || swControlled === null
    || returningVisit === null
    || hiddenBeforePins === null
    || deviceClass === null
    || mobile === null
    || viewportWidth === null
    || viewportHeight === null
    || effectiveType === null
    || venueCount === null
  ) return null;

  const props: MapLoadTimingProps = {
    outcome,
    surface,
    landed_on_map: landedOnMap,
    mount_ms: mountMs,
    elapsed_ms: elapsedMs,
    nav_type: navType,
    sw_controlled: swControlled,
    returning_visit: returningVisit,
    hidden_before_pins: hiddenBeforePins,
    device_class: deviceClass,
    mobile,
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    effective_type: effectiveType,
    venue_count: venueCount,
  };
  for (const key of Object.keys(MAP_LOAD_MILESTONES) as MapLoadMilestone[]) {
    const value = boundedInt(input[key], MAX_TIMING_MS);
    if (value !== null) props[key] = value;
  }
  // A painted visit without its paint time is not a measurement.
  if (outcome === "painted" && props.pins_visible_ms === undefined) return null;
  // A timeout or abandoned visit never painted, whatever the bag claimed.
  if (outcome !== "painted") delete props.pins_visible_ms;

  const saveData = bool(input.save_data);
  if (saveData !== null) props.save_data = saveData;
  if (typeof input.device_memory === "number" && DEVICE_MEMORY_BUCKETS.has(input.device_memory)) {
    props.device_memory = input.device_memory;
  }
  const cores = boundedInt(input.hardware_concurrency, MAX_HARDWARE_CONCURRENCY);
  if (cores !== null && cores >= 1) props.hardware_concurrency = cores;
  return props;
}

/** Viewport width is the honest device class for a map: it decides the layout. */
export function mapLoadDeviceClass(viewportWidth: number): MapLoadDeviceClass {
  if (viewportWidth < 600) return "phone";
  if (viewportWidth < 1024) return "tablet";
  return "desktop";
}
