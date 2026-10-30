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
// It is a bounded count of DOM markers, the same exception the donut clusters
// take (donutClusters.ts): ONE for the reader's own Pal, plus at most
// CREW_PALS_MAX crew Pals on a crew plan (lib/crewPals.ts), each a step behind
// the last. It keeps to the map's rules:
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
// - beside a pin painted in the cheapest band it lands with a happy hop. It
//   reads the band the pin itself paints (palPinIsCheap), never a second copy
//   of the price rules;
// - on tonight's plan it walks only as far as the next stop and waits there
//   (nextStop). While it waits there, and only then, it is a button: "Next
//   stop: The Lamb", with a small "Next: The Lamb" chip, and a tap opens that
//   pub. Crew Pals wait there too but are never buttons. A still Pal waits at
//   the next stop instead of the first;
// - it sits up and to the right of the pin, never over it, and otherwise takes
//   no pointer events, so every pin under it stays tappable and the
//   painted-pin probe still finds the pin it names;
// - it is the Pal's rendered avatar held by its genome (lib/palGenome.ts),
//   never a drawing, and it is decorative except as that one button, so
//   assistive tech skips it;
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
  /** Arrive with a jump for joy, not a landing: the end of a way it led. */
  cheer?: boolean;
};

/**
 * Is this pin painted in the cheapest band? The same band the pin's colour and
 * pill read (buildScene.ts): the Spoons value band where that lens stamps one,
 * else the pub's price bucket. 0 is the cheapest of the four.
 */
export function palPinIsCheap(properties: { bucket?: unknown; spoonsBucket?: unknown } | null | undefined): boolean {
  if (!properties) return false;
  const painted = properties.spoonsBucket ?? properties.bucket;
  return painted === 0;
}

export type PalMapMarker = {
  /**
   * Perch beside this point, or step off the map with null. Ends any walk.
   * Beside a pin painted in the cheapest band it lands with a happy hop.
   */
  perch: (lngLat: LngLat | null, pin?: { cheap: boolean }) => void;
  /** Walk this crawl route once, then rest beside its last stop. */
  walk: (route: PalMapWalk) => void;
  /** The reader tapped this stop of the crawl (its index): go to it. */
  visit: (stop: number) => void;
  /**
   * Tonight's next stop on the route it walks, or null. The Pal walks no
   * further than it, waits beside it, and opens it when tapped there.
   */
  nextStop: (next: PalNextStop | null) => void;
  /**
   * Say one short line in a bubble above the Pal for a few seconds, or clear
   * it with null. The words come from the caller's own data, never invented.
   * A sleeping (muted) Pal and a crew Pal say nothing.
   */
  say: (line: string | null) => void;
  destroy: () => void;
};

/** Tonight's next stop: its index on the walked route, its pub's name, and how to open it. */
type PalNextStop = { stop: number; name: string; open: () => void };

const NO_PAL: PalMapMarker = {
  perch: () => {},
  walk: () => {},
  visit: () => {},
  nextStop: () => {},
  say: () => {},
  destroy: () => {},
};

/** How long a said line stays up. */
const SAY_MS = 5_000;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** What the marker draws of a Pal: its look, never its owner. */
export type PalMarkerLook = Pick<PubPal, "id" | "personality" | "muted"> & {
  appearance: Pick<PubPal["appearance"], "species">;
};

/** How far behind the reader's own Pal each crew Pal walks, in pixels. */
const CREW_STEP_PX = 24;

/** The marker's markup, as plain DOM: the map's markers live outside React. */
export function palMarkerElement(pal: PalMarkerLook): HTMLElement | null {
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

/**
 * The reader's own Pal, or, with `crew`, one crew member's Pal on a crew plan
 * (Pals walk together, lib/crewPals.ts). A crew Pal walks the same route a
 * step behind the one before it, and only the reader's own Pal answers the
 * reader's Pal moments.
 */
export function createPalMapMarker(map: maplibregl.Map, crew?: { pal: PalMarkerLook; index: number }): PalMapMarker {
  const own = crew ? null : readLocalPal();
  if (!crew && (!own || own.hidden)) return NO_PAL;
  const pal: PalMarkerLook = crew ? crew.pal : own!;
  const element = palMarkerElement(pal);
  if (!element) return NO_PAL;
  const crewStep = crew ? (crew.index + 1) * CREW_STEP_PX : 0;
  const perchOffset: [number, number] = [PERCH_OFFSET[0] + crewStep, PERCH_OFFSET[1]];
  const walkOffset: [number, number] = [WALK_OFFSET[0] - crewStep, WALK_OFFSET[1]];
  if (crew) {
    element.classList.add("isCrew");
    element.dataset.palCrew = String(crew.index);
  }
  const body = element.querySelector<HTMLElement>(".palMapMarkerBody")!;
  // The chip that names tonight's next stop, shown only while the Pal waits there.
  const nextLabel = document.createElement("span");
  nextLabel.className = "palMapMarkerNext";
  nextLabel.hidden = true;
  // The bubble for a said line: decorative like the Pal, as the same words are
  // in the list the reader just tapped.
  const sayBubble = document.createElement("span");
  sayBubble.className = "palMapMarkerSay";
  sayBubble.hidden = true;
  element.append(nextLabel, sayBubble);
  let sayTimer = 0;
  // A line said while the walk waits for the map to paint, said when it sets off.
  let heldLine: string | null = null;
  const hush = () => {
    heldLine = null;
    window.clearTimeout(sayTimer);
    sayTimer = 0;
    sayBubble.hidden = true;
    sayBubble.textContent = "";
  };
  const speak = (line: string) => {
    hush();
    sayBubble.textContent = line;
    sayBubble.hidden = false;
    restartClass("isSaying");
    sayTimer = window.setTimeout(hush, SAY_MS);
  };

  let marker: maplibregl.Marker | null = null;
  let next: PalNextStop | null = null;
  let perchedAt: string | null = null;
  /** A trip along the route to one stop. `following` is a trip to tonight's next stop, not one the reader asked for. */
  type Visit = { from: number; to: number; stop: number; elapsed: number; durationMs: number; following: boolean };
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
    /** Jump for joy at the end of the walk instead of landing. */
    cheer: boolean;
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

  // A button only while it waits beside tonight's next stop; anywhere else it
  // is decorative and takes no taps.
  let tappable = false;
  const syncTap = () => {
    // A crew Pal waits at the next stop too, but is never a button.
    const waiting = !crew && walk !== null && next !== null && !walk.visit
      && walk.elapsed >= walk.plan.durationMs && walk.restAt === next.stop;
    const label = waiting ? next!.name : null;
    if (label === null) {
      if (!tappable) return;
      tappable = false;
      element.classList.remove("isNextStop");
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-label");
      element.setAttribute("aria-hidden", "true");
      nextLabel.hidden = true;
      nextLabel.textContent = "";
      return;
    }
    tappable = true;
    // The chip takes the space above the Pal; a said line has had its moment.
    hush();
    element.classList.add("isNextStop");
    element.setAttribute("role", "button");
    element.tabIndex = 0;
    element.setAttribute("aria-label", `Next stop: ${label}`);
    element.removeAttribute("aria-hidden");
    nextLabel.textContent = `Next: ${label}`;
    nextLabel.hidden = false;
  };
  const openNext = (event: Event) => {
    if (!tappable || !next) return;
    event.preventDefault();
    event.stopPropagation();
    next.open();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") openNext(event);
  };
  if (!crew) {
    element.addEventListener("click", openNext);
    element.addEventListener("keydown", onKey);
  }

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
    syncTap();
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
    place(walk.stops[stop]!, perchOffset);
    restartClass(state === "visited" || walk.cheer ? "isCheering" : "isLanding");
    syncTap();
    if (victoryPending) victory();
  };

  // The stop a finished walk rests beside: tonight's next stop when it is on
  // this route, else the last stop.
  const restStop = (): number => {
    if (!walk) return 0;
    return next && next.stop >= 0 && next.stop < walk.stops.length ? next.stop : walk.stops.length - 1;
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
      place(at, walkOffset);
      frame = requestAnimationFrame(step);
      return;
    }
    walk.elapsed += delta;
    const moment = palWalkAt(walk.plan, walk.elapsed);
    const resting = restStop();
    // On tonight's plan the walk ends at the next stop, not the last one.
    if (moment.done || (resting < walk.stops.length - 1 && moment.metres >= walk.plan.stopsAt[resting]!)) {
      restBeside(resting, "rested");
      return;
    }
    walk.metres = moment.metres;
    body.style.setProperty("--pal-facing", String(moment.heading));
    element.classList.toggle("isWalking", moment.pausedAt === null);
    if (moment.pausedAt !== null && moment.pausedAt !== pausedAt) restartClass("isLanding");
    pausedAt = moment.pausedAt;
    place(moment.at, walkOffset);
    frame = requestAnimationFrame(step);
  };

  // Send the Pal along the route to one stop: one the reader tapped, or
  // tonight's next stop (`following`).
  const goTo = (stop: number, following: boolean) => {
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
    walk.visit = { from: walk.metres, to, stop, elapsed: 0, durationMs: palVisitMs(to - walk.metres), following };
    // A tap ends the crawl walk: the Pal does not go back to it.
    walk.elapsed = walk.plan.durationMs;
    walk.restAt = null;
    element.classList.remove("isCheering");
    element.dataset.palWalk = "visiting";
    syncTap();
    // A walk still waiting for the map to load takes the trip when it starts.
    if (frame || cancelStart) return;
    lastFrameAt = performance.now();
    frame = requestAnimationFrame(step);
  };

  const api: PalMapMarker = {
    perch: (lngLat, pin) => {
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
      // The band is part of the perch, so a pin repainted cheap (or no longer
      // cheap) under the Pal lands it again in its new band.
      const key = `${lngLat[0].toFixed(6)},${lngLat[1].toFixed(6)}|${pin?.cheap ? "cheap" : ""}`;
      if (key === perchedAt) return;
      perchedAt = key;
      place(lngLat, perchOffset);
      if (pin?.cheap) {
        element.dataset.palPin = "cheap";
        restartClass("isCheering");
      } else {
        delete element.dataset.palPin;
        element.classList.remove("isCheering");
        restartClass("isLanding");
      }
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
        walk = {
          key: route.key,
          road,
          plan,
          stops: route.stops,
          elapsed: 0,
          metres: 0,
          restAt: null,
          visit: null,
          cheer: route.cheer === true,
        };
      }
      // A sleeping (muted) Pal, like reduced motion, waits at the first stop,
      // or at tonight's next stop when there is one.
      if (pal.muted || prefersReducedMotion()) {
        const waitAt = next ? restStop() : 0;
        walk.elapsed = plan.durationMs;
        walk.restAt = waitAt;
        walk.metres = plan.stopsAt[waitAt]!;
        element.dataset.palWalk = "waiting";
        place(route.stops[waitAt]!, perchOffset);
        syncTap();
        return;
      }
      const start = () => {
        cancelStart?.();
        cancelStart = null;
        if (heldLine) speak(heldLine);
        if (!walk || frame) return;
        if (!walk.visit) element.dataset.palWalk = "walking";
        lastFrameAt = performance.now();
        frame = requestAnimationFrame(step);
      };
      if (frame || cancelStart) return;
      if (typeof map.loaded === "function" && !map.loaded()) {
        // Stand at the first stop until the map has painted.
        element.dataset.palWalk = "setting-off";
        place(route.stops[0]!, walkOffset);
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
    visit: (stop) => goTo(stop, false),
    nextStop: (target) => {
      const same = next && target && next.stop === target.stop && next.name === target.name;
      next = target;
      if (same || !walk) {
        syncTap();
        return;
      }
      const onRoute = target !== null && target.stop >= 0 && target.stop < walk.stops.length;
      const finished = !walk.visit && walk.elapsed >= walk.plan.durationMs;
      // A finished walk goes on to the new next stop, as a tapped stop does,
      // and a trip still on its way to the old next stop turns for the new
      // one. A trip the reader asked for keeps going where they sent it.
      const followingElsewhere = walk.visit?.following === true && walk.visit.stop !== target?.stop;
      if (onRoute && ((finished && walk.restAt !== target.stop) || followingElsewhere)) {
        goTo(target.stop, true);
        return;
      }
      syncTap();
    },
    say: (line) => {
      hush();
      if (!line || crew || pal.muted) return;
      // Nobody sees a line said over a map still loading: hold it for the start.
      if (cancelStart) {
        heldLine = line;
        return;
      }
      speak(line);
    },
    destroy: () => {
      hush();
      element.removeEventListener("click", openNext);
      element.removeEventListener("keydown", onKey);
      unsubscribe();
      stopWalking();
      marker?.remove();
      marker = null;
      perchedAt = null;
    },
  };

  // A finished crawl or night: on a crawl, run to the last stop first. A crew
  // Pal walks for its own owner, so it never answers the reader's moments.
  const unsubscribe = crew ? () => {} : subscribePalMoments((moment) => {
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
