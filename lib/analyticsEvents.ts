// The self-owned analytics event set (Wave D · D0). One registry, shared by the
// client beacon (lib/analytics.ts) and the ingest route (app/api/events), so
// both agree on which events exist and which props each may carry.
//
// First-party and privacy-first by construction: NO third-party tracker, NO
// identifiers, NO free-text. Every event is a fixed name from this registry and
// its props are a small allow-list of low-cardinality primitives — anything
// else is dropped before it can leave the device or land in the log. This keeps
// the "measurement spine" the other waves draw their success signals from
// honest and PII-free even as new events are added.

/** Allowed prop keys per event. An empty list means the event carries no props. */
export const ANALYTICS_EVENTS = {
  // R3 cycle metrics rail (carried over from the original Vercel-backed
  // trackEvent; ported onto this self-owned registry so the same closed set
  // of ~10 named events keeps working under the D0 beacon).
  badge_tap: [],
  lane_card_tap: [],
  lane_to_plan: ["source", "stops"],
  cmdk_open: [],
  night_mode_active: [],
  drop_logged: [],
  booking_click: ["venueId", "tier"],
  whats_on_filter: [],
  // Wave F · F3 — concierge-as-map-home
  concierge_ask: [],
  concierge_result_tap: [],
  tour_complete: ["completed"],
  plan_created: ["count"],
  // Wave A
  tonight_screen_view: [],
  tonight_filter_select: ["kind"],
  event_chip_view: ["kind"],
  // Wave D
  poster_shared: ["surface"],
  streak_increment: ["days"],
  streak_view: ["days"],
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export type AnalyticsProps = Record<string, string | number | boolean>;

/** A validated, ready-to-send event. */
export type AnalyticsEvent = {
  name: AnalyticsEventName;
  props: AnalyticsProps;
};

const MAX_STRING_LEN = 40;

export function isKnownEvent(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/**
 * A prop value is safe only when it is a low-cardinality primitive: a short
 * string with no "@" (a cheap guard against emails / handles slipping in), a
 * finite number, or a boolean. Everything else is rejected.
 */
function isSafeValue(value: unknown): value is string | number | boolean {
  if (typeof value === "string") {
    return value.length > 0 && value.length <= MAX_STRING_LEN && !value.includes("@");
  }
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "boolean";
}

/**
 * Validate + narrow an event to exactly what the registry permits. Unknown
 * event names return null; unknown or unsafe prop keys/values are dropped
 * silently so a bad prop never blocks a legitimate event. The result is safe to
 * both send from the client and persist server-side.
 */
export function sanitizeEvent(
  name: string,
  props?: Record<string, unknown> | null,
): AnalyticsEvent | null {
  if (!isKnownEvent(name)) return null;
  const allowedKeys = ANALYTICS_EVENTS[name] as readonly string[];
  const out: AnalyticsProps = {};
  if (props && typeof props === "object") {
    for (const key of allowedKeys) {
      const value = (props as Record<string, unknown>)[key];
      if (value !== undefined && isSafeValue(value)) {
        out[key] = value;
      }
    }
  }
  return { name, props: out };
}
