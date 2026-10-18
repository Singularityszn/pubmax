import * as maplibregl from "maplibre-gl";

import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import { pubPalMascotSlugFor, pubPalMascotSrc } from "@/lib/pubPalMascot";
import type { PubPal } from "@/lib/pubPal";
import { safeLocalStorage } from "@/lib/safeStorage";
import { palWalkAt, palWalkPlan, type LngLat, type PalWalkPlan } from "./palWalk";
import "./palMarker.css";

// The Pal on the map: the reader's own Pub Pal perched beside the pub they
// have open, or, on a crawl, walking the route from stop to stop.
//
// It is ONE DOM marker, the same bounded-count exception the donut clusters
// take (donutClusters.ts), and it keeps to the map's rules:
// - it never moves the camera ("Nothing moves this camera but the reader"):
//   it only appears where the reader is already looking, beside the selected
//   pin, and hops when the selection changes;
// - on a crawl it walks the route ONCE, pausing at each stop, and rests beside
//   the last stop: it moves for a window after a change, then rests, like the
//   route dash. Under reduced motion it never walks and waits at the first
//   stop. Its clock only runs on painted frames, so a hidden tab holds it;
// - it sits up and to the right of the pin, never over it, and takes no
//   pointer events, so every pin under it stays tappable and the painted-pin
//   probe still finds the pin it names;
// - it is the Pal's rendered avatar held by its genome (lib/palGenome.ts),
//   never a drawing, and it is decorative, so assistive tech skips it;
// - with no Pal, or a Pal the reader hid, it is never made.

const PAL_STORAGE_KEY = "pubmax_pub_pal_v1";
const MARKER_PX = 38;
// Perched: up and to the right of the pin. Walking: standing on the line.
const PERCH_OFFSET: [number, number] = [14, -12];
const WALK_OFFSET: [number, number] = [-MARKER_PX / 2, 4];
// A held frame (a hidden tab, a slow device) never jumps the Pal ahead.
const MAX_FRAME_MS = 100;
// A walk waits for the map to finish loading, so the reader sees it from the
// first step, but never longer than this.
const START_WAIT_MS = 4_000;

type PalMapWalk = {
  /** The route's identity: the same key never restarts a walk. */
  key: string;
  stops: LngLat[];
  /** The line to walk: the stops themselves, or the road line once routed. */
  path: LngLat[];
  /** True for the road line. A straight line never replaces a road one. */
  road?: boolean;
};

export type PalMapMarker = {
  /** Perch beside this point, or step off the map with null. Ends any walk. */
  perch: (lngLat: LngLat | null) => void;
  /** Walk this crawl route once, then rest beside its last stop. */
  walk: (route: PalMapWalk) => void;
  destroy: () => void;
};

const NO_PAL: PalMapMarker = { perch: () => {}, walk: () => {}, destroy: () => {} };

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function storedPal(): PubPal | null {
  try {
    const raw = safeLocalStorage()?.getItem(PAL_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PubPal> | null;
    if (!value || typeof value !== "object" || !value.id || !value.appearance) return null;
    return value as PubPal;
  } catch {
    return null;
  }
}

/** The marker's markup, as plain DOM: the map's markers live outside React. */
export function palMarkerElement(pal: PubPal): HTMLElement | null {
  const slug = pubPalMascotSlugFor(pal.appearance.species);
  if (!slug) return null;
  const element = document.createElement("div");
  element.className = "palMapMarker";
  element.setAttribute("aria-hidden", "true");
  if (pal.muted) element.dataset.palState = "sleeping";
  const body = document.createElement("span");
  body.className = "palMapMarkerBody";
  for (const [name, value] of Object.entries(palGenomeStyle(palGenomeFor(pal.id, pal.personality)))) {
    body.style.setProperty(name, value);
  }
  const image = document.createElement("img");
  image.src = pubPalMascotSrc(slug, "avatar", 64, "webp");
  image.alt = "";
  image.width = MARKER_PX;
  image.height = MARKER_PX;
  image.decoding = "async";
  image.draggable = false;
  body.append(image);
  element.append(body);
  return element;
}

export function createPalMapMarker(map: maplibregl.Map): PalMapMarker {
  const pal = storedPal();
  if (!pal || pal.hidden) return NO_PAL;
  const element = palMarkerElement(pal);
  if (!element) return NO_PAL;
  const body = element.querySelector<HTMLElement>(".palMapMarkerBody")!;

  let marker: maplibregl.Marker | null = null;
  let perchedAt: string | null = null;
  let walk: { key: string; road: boolean; plan: PalWalkPlan; stops: LngLat[]; elapsed: number } | null = null;
  let frame = 0;
  let lastFrameAt = 0;
  let pausedAt: number | null = null;
  let cancelStart: (() => void) | null = null;

  const restartClass = (name: string) => {
    // A reflow between removing and adding the class restarts its animation.
    element.classList.remove(name);
    void element.offsetWidth;
    element.classList.add(name);
  };

  const place = (lngLat: LngLat, offset: [number, number]) => {
    if (!marker) {
      marker = new maplibregl.Marker({ element, anchor: "bottom-left", offset })
        .setLngLat(lngLat)
        .addTo(map);
    } else {
      marker.setOffset(offset);
      marker.setLngLat(lngLat);
    }
  };

  const stopWalking = () => {
    cancelStart?.();
    cancelStart = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    walk = null;
    pausedAt = null;
    element.classList.remove("isWalking");
    delete element.dataset.palWalk;
  };

  const rest = (lngLat: LngLat) => {
    element.classList.remove("isWalking");
    element.dataset.palWalk = "rested";
    perchedAt = null;
    place(lngLat, PERCH_OFFSET);
    restartClass("isLanding");
  };

  const step = (now: number) => {
    frame = 0;
    if (!walk) return;
    walk.elapsed += Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
    lastFrameAt = now;
    const moment = palWalkAt(walk.plan, walk.elapsed);
    if (moment.done) {
      const last = walk.stops[walk.stops.length - 1]!;
      frame = 0;
      walk.elapsed = walk.plan.durationMs;
      rest(last);
      return;
    }
    body.style.setProperty("--pal-facing", String(moment.heading));
    element.classList.toggle("isWalking", moment.pausedAt === null);
    if (moment.pausedAt !== null && moment.pausedAt !== pausedAt) restartClass("isLanding");
    pausedAt = moment.pausedAt;
    place(moment.at, WALK_OFFSET);
    frame = requestAnimationFrame(step);
  };

  return {
    perch: (lngLat) => {
      if (walk) {
        stopWalking();
        perchedAt = null;
      }
      if (!lngLat) {
        marker?.remove();
        marker = null;
        perchedAt = null;
        return;
      }
      const key = `${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)}`;
      if (key === perchedAt) return;
      perchedAt = key;
      place(lngLat, PERCH_OFFSET);
      restartClass("isLanding");
    },
    walk: (route) => {
      const road = route.road === true;
      if (walk && walk.key === route.key && (walk.road || !road)) return;
      const plan = palWalkPlan(route.path, route.stops);
      if (!plan) return;
      perchedAt = null;
      if (walk && walk.key === route.key) {
        // The road line for the same stops: carry on at the same point of the walk.
        const share = walk.plan.durationMs > 0 ? walk.elapsed / walk.plan.durationMs : 1;
        const finished = walk.elapsed >= walk.plan.durationMs;
        walk = { ...walk, road, plan, elapsed: share * plan.durationMs };
        if (finished) return;
      } else {
        stopWalking();
        walk = { key: route.key, road, plan, stops: route.stops, elapsed: 0 };
      }
      // A sleeping (muted) Pal, like reduced motion, waits at the first stop.
      if (pal.muted || prefersReducedMotion()) {
        walk.elapsed = plan.durationMs;
        element.dataset.palWalk = "waiting";
        place(route.stops[0]!, PERCH_OFFSET);
        return;
      }
      const start = () => {
        cancelStart?.();
        cancelStart = null;
        if (!walk || frame) return;
        element.dataset.palWalk = "walking";
        lastFrameAt = performance.now();
        frame = requestAnimationFrame(step);
      };
      if (frame || cancelStart) return;
      if (typeof map.loaded === "function" && !map.loaded()) {
        // Stand at the first stop until the map has painted.
        element.dataset.palWalk = "setting-off";
        place(route.stops[0]!, WALK_OFFSET);
        const timer = window.setTimeout(start, START_WAIT_MS);
        map.once("idle", start);
        cancelStart = () => {
          window.clearTimeout(timer);
          map.off("idle", start);
        };
        return;
      }
      start();
    },
    destroy: () => {
      stopWalking();
      marker?.remove();
      marker = null;
      perchedAt = null;
    },
  };
}
