// Field timing for the map: one `map_load_timing` event per map visit, read
// from the same `pubmax:*` performance marks the local profiles use, so the
// owner's p99 time-to-pins is measured on real visitors rather than one rig.
//
// The visit ends in exactly one outcome: `painted` when the pin layers first
// become visible, `timeout` when they have not after MAP_LOAD_TIMEOUT_MS, or
// `abandoned` when the page is hidden for good or the map unmounts first. The
// last two are the tail a paint-only metric would never see.
//
// Nothing is sent without analytics consent (the shared gate in
// lib/analytics.ts, Do-Not-Track included), and nothing here fetches before
// the pins: the event rides the already-loaded PostHog browser SDK.

import { analyticsCollectionAllowed } from "@/lib/analytics";
import { analyticsPageviewSurfaceFromPath } from "@/lib/analyticsPath";
import {
  MAP_LOAD_EFFECTIVE_TYPES,
  MAP_LOAD_MILESTONES,
  MAP_LOAD_NAV_TYPES,
  MAP_LOAD_OTHER_SURFACE,
  MAP_LOAD_TIMEOUT_MS,
  mapLoadDeviceClass,
  type MapLoadEffectiveType,
  type MapLoadMilestone,
  type MapLoadNavType,
  type MapLoadOutcome,
  type MapLoadTimingProps,
} from "@/lib/mapLoadTimingEvent";
import { FIRST_PINS_SEEN_KEY, PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";
import { capturePosthogMapLoadTiming } from "@/lib/posthogClient";

type NavigatorWithHints = Navigator & {
  connection?: { effectiveType?: unknown; saveData?: unknown };
  deviceMemory?: unknown;
  userAgentData?: { mobile?: unknown };
};

export type MapLoadTimingOptions = {
  /** performance.now() when the map visit began (its first render). */
  mountMs: number;
  /** The venues the map holds at the moment the visit ends. */
  venueCount: () => number;
  timeoutMs?: number;
  collectionAllowed?: () => boolean;
  capture?: (props: MapLoadTimingProps, options: { beacon?: boolean }) => void;
};

function firstMarkSince(name: string, sinceMs: number): number | null {
  try {
    const entry = performance
      .getEntriesByName(name, "mark")
      .find((mark) => mark.startTime >= sinceMs);
    return entry ? entry.startTime : null;
  } catch {
    return null;
  }
}

function navigationEntry(): PerformanceNavigationTiming | null {
  try {
    const [entry] = performance.getEntriesByType("navigation");
    return (entry as PerformanceNavigationTiming | undefined) ?? null;
  } catch {
    return null;
  }
}

function navType(entry: PerformanceNavigationTiming | null): MapLoadNavType {
  const type = entry?.type as string | undefined;
  return (MAP_LOAD_NAV_TYPES as readonly string[]).includes(type ?? "")
    ? (type as MapLoadNavType)
    : "unknown";
}

/** Did this document's own navigation land on the page the map is on? */
function landedOnMap(entry: PerformanceNavigationTiming | null): boolean {
  if (!entry?.name) return false;
  try {
    return new URL(entry.name).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

function effectiveType(nav: NavigatorWithHints): MapLoadEffectiveType {
  const value = nav.connection?.effectiveType;
  return (MAP_LOAD_EFFECTIVE_TYPES as readonly unknown[]).includes(value)
    ? (value as MapLoadEffectiveType)
    : "unknown";
}

function isMobile(nav: NavigatorWithHints): boolean {
  if (typeof nav.userAgentData?.mobile === "boolean") return nav.userAgentData.mobile;
  try {
    return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  } catch {
    return false;
  }
}

function returningVisit(): boolean {
  try {
    return window.localStorage.getItem(FIRST_PINS_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Start timing one map visit. Returns the stop function the visit's owner
 * calls on unmount; stopping before an outcome records `abandoned`.
 */
export function startMapLoadTiming(options: MapLoadTimingOptions): () => void {
  if (typeof window === "undefined" || typeof performance === "undefined") {
    return () => {};
  }
  const {
    mountMs,
    venueCount,
    timeoutMs = MAP_LOAD_TIMEOUT_MS,
    collectionAllowed = analyticsCollectionAllowed,
    capture = capturePosthogMapLoadTiming,
  } = options;
  const nav = (typeof navigator === "undefined" ? {} : navigator) as NavigatorWithHints;
  const entry = navigationEntry();
  // Read before this visit's own first pins write the key.
  const returning = returningVisit();
  const swControlled = Boolean(nav.serviceWorker?.controller);
  let hiddenBeforePins = document.visibilityState === "hidden";
  let done = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onVisibility = () => {
    if (document.visibilityState === "hidden") hiddenBeforePins = true;
  };
  const detach = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    window.removeEventListener(PINS_VISIBLE_EVENT, onPinsVisible);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };

  function report(outcome: MapLoadOutcome, beacon = false): void {
    if (done) return;
    done = true;
    detach();
    try {
      if (!collectionAllowed()) return;
      const now = performance.now();
      const viewportWidth = window.innerWidth;
      const props: MapLoadTimingProps = {
        outcome,
        surface: analyticsPageviewSurfaceFromPath(window.location.pathname)
          ?? MAP_LOAD_OTHER_SURFACE,
        landed_on_map: landedOnMap(entry),
        mount_ms: Math.round(mountMs),
        elapsed_ms: Math.round(now),
        nav_type: navType(entry),
        sw_controlled: swControlled,
        returning_visit: returning,
        hidden_before_pins: hiddenBeforePins,
        device_class: mapLoadDeviceClass(viewportWidth),
        mobile: isMobile(nav),
        viewport_width: viewportWidth,
        viewport_height: window.innerHeight,
        effective_type: effectiveType(nav),
        venue_count: Math.max(0, Math.round(venueCount())),
      };
      for (const [key, mark] of Object.entries(MAP_LOAD_MILESTONES) as [MapLoadMilestone, string][]) {
        const at = firstMarkSince(mark, mountMs);
        if (at !== null) props[key] = Math.round(at);
      }
      if (outcome === "painted") {
        props.pins_visible_ms ??= Math.round(now);
      } else {
        delete props.pins_visible_ms;
      }
      if (typeof nav.connection?.saveData === "boolean") props.save_data = nav.connection.saveData;
      if (typeof nav.deviceMemory === "number") props.device_memory = nav.deviceMemory;
      if (typeof nav.hardwareConcurrency === "number") {
        props.hardware_concurrency = nav.hardwareConcurrency;
      }
      capture(props, beacon ? { beacon: true } : {});
    } catch {
      // Field timing is diagnostic only; it must never break the map.
    }
  }

  function onPinsVisible(): void {
    report("painted");
  }
  function onPageHide(event: PageTransitionEvent): void {
    // A page kept in the back/forward cache may come back and paint.
    if (event.persisted) return;
    report("abandoned", true);
  }

  if (firstMarkSince(MAP_LOAD_MILESTONES.pins_visible_ms, mountMs) !== null) {
    report("painted");
    return () => {};
  }
  window.addEventListener(PINS_VISIBLE_EVENT, onPinsVisible);
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);
  // The clock runs from the visit's first render, not from this effect.
  timer = setTimeout(
    () => report("timeout"),
    Math.max(0, mountMs + timeoutMs - performance.now()),
  );

  return () => report("abandoned");
}
