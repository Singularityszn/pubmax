import * as maplibregl from "maplibre-gl";

import { palGenomeFor, palGenomeStyle } from "@/lib/palGenome";
import { pubPalMascotSlugFor, pubPalMascotSrc } from "@/lib/pubPalMascot";
import type { PubPal } from "@/lib/pubPal";
import { readLocalPal } from "@/lib/localPal";
import { palMomentIsFinish, subscribePalMoments } from "@/lib/palMoments";
import { palVisitMs, palWalkAt, palWalkPlan, palWalkPointAt, type LngLat, type PalWalkPlan } from "./palWalk";
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
// - when the reader taps a crawl stop it walks along the route to that stop,
//   backwards if it must, and jumps for joy beside it. A still Pal (reduced
//   motion, or muted) steps straight there instead;
// - when the reader finishes a crawl or a planned night (lib/palMoments.ts) it
//   runs to the last stop and celebrates with a burst of sparks, once; for a
//   price the reader added it hops for joy where it stands;
// - it sits up and to the right of the pin, never over it, and takes no
//   pointer events, so every pin under it stays tappable and the painted-pin
//   probe still finds the pin it names;
// - it is the Pal's rendered avatar held by its genome (lib/palGenome.ts),
//   never a drawing, and it is decorative, so assistive tech skips it;
// - with no Pal, or a Pal the reader hid, it is never made.

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
  /** The reader tapped this stop of the crawl (its index): go to it. */
  visit: (stop: number) => void;
  destroy: () => void;
};

const NO_PAL: PalMapMarker = { perch: () => {}, walk: () => {}, visit: () => {}, destroy: () => {} };

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
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
  // The victory burst: eight sparks that fly out once (palMarker.css).
  const sparks = document.createElement("span");
  sparks.className = "palMapSparks";
  for (let index = 0; index < 8; index += 1) {
    const spark = document.createElement("i");
    spark.style.setProperty("--spark", String(index));
    sparks.append(spark);
  }
  element.append(body, sparks);
  return element;
}

export function createPalMapMarker(map: maplibregl.Map): PalMapMarker {
  const pal = readLocalPal();
  if (!pal || pal.hidden) return NO_PAL;
  const element = palMarkerElement(pal);
  if (!element) return NO_PAL;
  const body = element.querySelector<HTMLElement>(".palMapMarkerBody")!;

  let marker: maplibregl.Marker | null = null;
  let perchedAt: string | null = null;
  type Visit = { from: number; to: number; stop: number; elapsed: number; durationMs: number };
  let walk: {
    key: string;
    road: boolean;
    plan: PalWalkPlan;
    stops: LngLat[];
    /** Time into the one crawl walk; at its duration, the walk is over. */
    elapsed: number;
    /** Metres along the route the Pal stands at. */
    metres: number;
    /** The stop it rests beside, if any. */
    restAt: number | null;
    visit: Visit | null;
  } | null = null;
  let frame = 0;
  let lastFrameAt = 0;
  let pausedAt: number | null = null;
  let cancelStart: (() => void) | null = null;
  let victoryPending = false;

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

  const victory = () => {
    victoryPending = false;
    element.dataset.palMoment = "victory";
    restartClass("isVictory");
  };

  const stopWalking = () => {
    victoryPending = false;
    cancelStart?.();
    cancelStart = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    walk = null;
    pausedAt = null;
    element.classList.remove("isWalking", "isCheering");
    delete element.dataset.palWalk;
  };

  // Rest beside a stop: "rested" at the end of the crawl walk, "visited"
  // after the reader sent it there, when it jumps for joy.
  const restBeside = (stop: number, state: "rested" | "visited") => {
    if (!walk) return;
    walk.visit = null;
    walk.elapsed = walk.plan.durationMs;
    walk.restAt = stop;
    walk.metres = walk.plan.stopsAt[stop]!;
    element.classList.remove("isWalking");
    element.dataset.palWalk = state;
    perchedAt = null;
    place(walk.stops[stop]!, PERCH_OFFSET);
    restartClass(state === "visited" ? "isCheering" : "isLanding");
    if (victoryPending) victory();
  };

  const step = (now: number) => {
    frame = 0;
    if (!walk) return;
    const delta = Math.min(MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
    lastFrameAt = now;
    if (walk.visit) {
      const visit = walk.visit;
      visit.elapsed += delta;
      const t = Math.min(1, visit.elapsed / visit.durationMs);
      if (t >= 1) {
        restBeside(visit.stop, "visited");
        return;
      }
      const eased = t * t * (3 - 2 * t);
      const { at, metres, heading } = palWalkPointAt(walk.plan, visit.from + (visit.to - visit.from) * eased);
      walk.metres = metres;
      body.style.setProperty("--pal-facing", String(visit.to < visit.from ? -heading : heading));
      element.classList.add("isWalking");
      place(at, WALK_OFFSET);
      frame = requestAnimationFrame(step);
      return;
    }
    walk.elapsed += delta;
    const moment = palWalkAt(walk.plan, walk.elapsed);
    if (moment.done) {
      restBeside(walk.stops.length - 1, "rested");
      return;
    }
    walk.metres = moment.metres;
    body.style.setProperty("--pal-facing", String(moment.heading));
    element.classList.toggle("isWalking", moment.pausedAt === null);
    if (moment.pausedAt !== null && moment.pausedAt !== pausedAt) restartClass("isLanding");
    pausedAt = moment.pausedAt;
    place(moment.at, WALK_OFFSET);
    frame = requestAnimationFrame(step);
  };

  const api: PalMapMarker = {
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
        // The road line for the same stops: carry on at the same point of the
        // walk, or of the trip to a tapped stop.
        const share = walk.plan.durationMs > 0 ? walk.elapsed / walk.plan.durationMs : 1;
        const finished = walk.elapsed >= walk.plan.durationMs;
        const scale = plan.total / walk.plan.total;
        const visit = walk.visit
          ? { ...walk.visit, from: walk.visit.from * scale, to: plan.stopsAt[walk.visit.stop]! }
          : null;
        const metres = walk.restAt !== null ? plan.stopsAt[walk.restAt]! : walk.metres * scale;
        walk = { ...walk, road, plan, elapsed: share * plan.durationMs, metres, visit };
        if (finished) return;
      } else {
        stopWalking();
        walk = { key: route.key, road, plan, stops: route.stops, elapsed: 0, metres: 0, restAt: null, visit: null };
      }
      // A sleeping (muted) Pal, like reduced motion, waits at the first stop.
      if (pal.muted || prefersReducedMotion()) {
        walk.elapsed = plan.durationMs;
        walk.restAt = 0;
        element.dataset.palWalk = "waiting";
        place(route.stops[0]!, PERCH_OFFSET);
        return;
      }
      const start = () => {
        cancelStart?.();
        cancelStart = null;
        if (!walk || frame) return;
        if (!walk.visit) element.dataset.palWalk = "walking";
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
    visit: (stop) => {
      if (!walk || !Number.isInteger(stop) || stop < 0 || stop >= walk.stops.length) return;
      if (pal.muted || prefersReducedMotion()) {
        // A still Pal steps straight to the stop.
        cancelStart?.();
        cancelStart = null;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        restBeside(stop, "visited");
        return;
      }
      if (!walk.visit && walk.restAt === stop && walk.elapsed >= walk.plan.durationMs) {
        // Already beside it: just the jump.
        element.dataset.palWalk = "visited";
        restartClass("isCheering");
        return;
      }
      const to = walk.plan.stopsAt[stop]!;
      walk.visit = { from: walk.metres, to, stop, elapsed: 0, durationMs: palVisitMs(to - walk.metres) };
      // A tap ends the crawl walk: the Pal does not go back to it.
      walk.elapsed = walk.plan.durationMs;
      walk.restAt = null;
      element.classList.remove("isCheering");
      element.dataset.palWalk = "visiting";
      // A walk still waiting for the map to load takes the trip when it starts.
      if (frame || cancelStart) return;
      lastFrameAt = performance.now();
      frame = requestAnimationFrame(step);
    },
    destroy: () => {
      unsubscribe();
      stopWalking();
      marker?.remove();
      marker = null;
      perchedAt = null;
    },
  };

  // A finished crawl or night: on a crawl, run to the last stop first.
  const unsubscribe = subscribePalMoments((moment) => {
    if (!marker) return;
    if (!palMomentIsFinish(moment)) {
      // A kept price: a happy hop where it stands.
      restartClass("isCheering");
      return;
    }
    if (walk) {
      const last = walk.stops.length - 1;
      const there = !walk.visit && walk.restAt === last && walk.elapsed >= walk.plan.durationMs;
      if (!there) {
        victoryPending = true;
        api.visit(last);
        return;
      }
    }
    victory();
  });

  return api;
}
