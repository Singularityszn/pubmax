"use client";

// Pal hops (wild idea 08). A round Pub Pal button on the map edge, "Find the
// cheapest": the robin hops out of it and across the screen from priced pin
// to priced pin, dearest first, squashing on take-off and landing and leaving
// little footprints, and lands beside the cheapest priced pin with a speech
// bubble: the price, the drink, the pub, who listed it and when, and "Show
// me", which opens that pub the way a pin tap does.
//
// THE MAP'S OWN ANSWERS, NEVER A COPY OF THEM:
// - what each pub costs, who listed it and the day it was read come from the
//   city's own slim pack rows (lib/slimShards.ts), the rows the map paints its
//   pills from, and which of them are on screen from the camera probe's own
//   projection (components/map/canvas/cameraProbe.ts);
// - on a phone the winner is the pub the map's own bottom card already names
//   ("Cheapest in this view", lib/mapPeek.ts), so the robin and the card can
//   never disagree; elsewhere it is the cheapest priced pub on screen, ranked
//   the way that card ranks;
// - the robin lands on the mark the map paints for each pub, from the
//   painted-pin probe (components/map/canvas/paintedPinProbe.ts): the pub's own
//   price pill, or the cluster disc it is gathered into, which reads "from"
//   that same cheapest price;
// - while the robin is out it re-reads where its mark is drawn every frame, so
//   a reader who pans keeps the robin on its pin;
// - the beer is named only when the pub's own record names it at that price
//   (lib/warmVenueDetail.ts, which also warms the sheet for Show me).
//
// NOTHING MOVES THIS CAMERA BUT THE READER. The robin is an overlay that takes
// no pointer events; only its bubble does. With no priced pin on screen it
// says so, and offers the nearest priced area as a tap, never a move of its
// own. Reduced motion: the robin is simply there, beside the cheapest pin.
//
// Loaded only while the wild switch is on (PalHopGate.tsx). `?palhop=1` starts
// a hop once the map has settled, for the captain's screenshots, and
// `?palhop=slow` does the same at a quarter speed.

import { MapPin, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import PriceBadge, { PintPriceBadge } from "@/components/PriceBadge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { CityId } from "@/lib/cities";
import { cityAwareMapPath } from "@/lib/cityMapHref";
import { formatGbp } from "@/lib/formatGbp";
import { ICON_SIZE } from "@/lib/iconScale";
import type { MapPeekModel } from "@/lib/mapPeek";
import { createSlimShardLoader } from "@/lib/slimShards";
import type { SlimVenue } from "@/lib/venuesSlim";
import { warmVenueDetail } from "@/lib/warmVenueDetail";
import { prefersReducedMotion } from "@/lib/wildMode";

import {
  PAL_HOP_PAUSE_MS,
  PAL_HOP_ROBIN_PX,
  nearestPricedArea,
  palHopAnswer,
  palHopArcPx,
  palHopBubblePlacement,
  palHopEmptyLine,
  palHopFlightMs,
  palHopFootprints,
  palHopPerch,
  palHopPose,
  palHopRoute,
  palHopViewBounds,
  stopsInView,
  type PalHopAnchor,
  type PalHopAnswer,
  type PalHopEmptyReason,
  type PalHopFootprint,
  type PalHopPoint,
  type PalHopRoute,
  type PalHopStop,
  type ScreenBox,
  type ScreenPoint,
  type ScreenRegion,
} from "./palHopPlan";
import "./palHop.css";

export type PalHopProps = {
  cityId: CityId;
  /** "edge": inside the phone map-edge column. "desktop": fixed on the map's right edge. */
  placement: "edge" | "desktop";
  /** Opens a pub the way the map does. Without it, Show me taps the painted pin. */
  onShowVenue?: (venueId: string) => void;
  /** True while the map shows another drink than pints. The robin hunts pints. */
  drinkLaneSelected?: boolean;
  /** The map's experience view ("all", or a no-alcohol or food view); pints show only under "all". */
  experienceView?: string | null;
  /** The phone map's bottom card. When it names a pint, that pub is the robin's answer too. */
  peek?: MapPeekModel | null;
};

const ROBIN_SRC = "url(/pal/circuit-robin-avatar-128.webp)";
const ROBIN_TALK_SRC = "url(/pal/circuit-robin-talk-avatar-128.webp)";
const PAL_HOP_PARAM = "palhop";
const LEAVE_MS = 200;
/** The longest the bubble waits for the pub's record to name the beer. */
const BEER_WAIT_MS = 1200;

type CameraReading = {
  center: [number, number];
  zoom: number;
  pitch: number;
  moving: boolean;
  settling: boolean;
};

type ProbeWindow = Window & {
  __pubmaxPaintedMapTapPoints?: () => PalHopPoint[];
  __pubmaxMapCamera?: {
    read: () => CameraReading;
    project: (lngLat: [number, number]) => ScreenPoint;
  };
};

type AreaOffer = { slug: string; name: string; href: string };

type Phase =
  | { kind: "idle" }
  | { kind: "looking"; run: number }
  | { kind: "hopping"; run: number; route: PalHopRoute | null; empty: EmptyNote | null }
  | { kind: "landed"; run: number; route: PalHopRoute; answer: PalHopAnswer }
  | { kind: "empty"; run: number; note: EmptyNote };

type EmptyNote = { reason: PalHopEmptyReason; area: AreaOffer | null };

type Print = PalHopFootprint & { key: string; delayMs: number };

function probeWindow(): ProbeWindow {
  return window as ProbeWindow;
}

/** The pins the map is painting now. Empty off the map or before it paints. */
function paintedPoints(): PalHopPoint[] {
  try {
    return probeWindow().__pubmaxPaintedMapTapPoints?.() ?? [];
  } catch {
    return [];
  }
}

function readCamera(): CameraReading | null {
  try {
    return probeWindow().__pubmaxMapCamera?.read() ?? null;
  } catch {
    return null;
  }
}

/** Where the map draws this point right now, or null without the camera probe. */
function project(lngLat: [number, number]): ScreenPoint | null {
  try {
    const point = probeWindow().__pubmaxMapCamera?.project(lngLat);
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  } catch {
    return null;
  }
}

/** Where the map draws this mark right now; where it was painted, failing that. */
function whereDrawn(mark: Pick<PalHopStop, "lng" | "lat" | "x" | "y">): ScreenPoint {
  return project([mark.lng, mark.lat]) ?? { x: mark.x, y: mark.y };
}

/** The robin's feet on a mark, wherever the map draws it now. */
function perchOn(anchor: PalHopAnchor, viewport: ScreenBox): ScreenPoint {
  return palHopPerch(whereDrawn(anchor), viewport, anchor.reach);
}

/** The map's own canvas: the largest MapLibre canvas on the page. */
function mapCanvas(): HTMLCanvasElement | null {
  let canvas: HTMLCanvasElement | null = null;
  let area = 0;
  for (const candidate of document.querySelectorAll<HTMLCanvasElement>(".maplibregl-canvas")) {
    const rect = candidate.getBoundingClientRect();
    if (rect.width * rect.height > area) {
      area = rect.width * rect.height;
      canvas = candidate;
    }
  }
  return canvas;
}

/** The part of the screen the map shows, under its top bar. */
function mapRegion(placement: PalHopProps["placement"], viewport: ScreenBox): ScreenRegion {
  const rect = mapCanvas()?.getBoundingClientRect();
  const left = Math.max(0, rect?.left ?? 0);
  const right = Math.min(viewport.width, rect?.right ?? viewport.width);
  const top = Math.max(0, rect?.top ?? 0) + (placement === "edge" ? 112 : 76);
  const bottom = Math.min(viewport.height, rect?.bottom ?? viewport.height) - 8;
  return { left: left + 8, right: right - 8, top, bottom };
}

/**
 * The bottom card's pub, when its answer is a pint: a pub, and no lens or
 * anchor label over the figure (lib/mapPeek.ts).
 */
function peekPintWinner(peek: MapPeekModel | null | undefined): { id: string; priceGbp: number } | null {
  if (!peek || peek.status !== "answer") return null;
  const { answer } = peek;
  if (!answer.isPub || answer.lineLabel || answer.anchor) return null;
  return { id: answer.venueId, priceGbp: answer.priceGbp };
}

function viewportBox(): ScreenBox {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The slim rows around what the camera shows, from the city's own packs. Null when unread. */
async function readSlimRows(
  cityId: CityId,
  camera: CameraReading,
  viewport: ScreenBox,
): Promise<SlimVenue[] | null> {
  try {
    const result = await createSlimShardLoader(cityId).initialResult(palHopViewBounds(camera, viewport));
    if (result.status !== "ready" && result.rows.length === 0) return null;
    return result.rows;
  } catch {
    return null;
  }
}

/** The beer, only when the pub's own record lists it at the winning price. */
async function beerFor(winner: PalHopStop): Promise<string | null> {
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), BEER_WAIT_MS));
  const result = await Promise.race([warmVenueDetail(winner.id), timeout]);
  if (!result || result.status !== "found") return null;
  const venue = result.venue;
  if (typeof venue.cheapestPrice !== "number") return null;
  if (Math.abs(venue.cheapestPrice - winner.priceGbp) > 0.005) return null;
  return venue.cheapestPint?.trim() || null;
}

/** The nearest patch with prices, as a door the reader may open. */
async function nearestAreaOffer(cityId: CityId): Promise<AreaOffer | null> {
  const camera = readCamera();
  if (!camera) return null;
  try {
    const [{ getNightAreasForCity }, { mapAreaHref }] = await Promise.all([
      import("@/lib/nightAreas"),
      import("@/lib/mapAreaArrival"),
    ]);
    const areas = getNightAreasForCity(cityId);
    const best = nearestPricedArea(areas, { lng: camera.center[0], lat: camera.center[1] });
    const area = best ? areas.find((candidate) => candidate.slug === best.slug) : null;
    return area ? { slug: area.slug, name: area.name, href: mapAreaHref(area) } : null;
  } catch {
    return null;
  }
}

/**
 * Show me on a map with no venue callback: a tap on the painted pin itself,
 * through the canvas's own click router (interactions.ts), so it opens exactly
 * what a finger on that pin opens. Returns false when the pub has no pin of
 * its own on screen (it is gathered into a cluster), because a tap there
 * would open the cluster rather than the pub.
 */
function tapPaintedPin(stop: PalHopStop): boolean {
  const painted = paintedPoints().find((point) => point.kind === "pin" && point.id === stop.id);
  const canvas = mapCanvas();
  if (!painted || !canvas) return false;
  const at = painted;
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: at.x,
    clientY: at.y,
    button: 0,
    view: window,
  };
  canvas.dispatchEvent(new MouseEvent("mousedown", { ...init, buttons: 1 }));
  canvas.dispatchEvent(new MouseEvent("mouseup", init));
  canvas.dispatchEvent(new MouseEvent("click", init));
  return true;
}

/** One transform write for the robin and one for its shadow. */
function placeRobin(
  robin: HTMLElement,
  shadow: HTMLElement | null,
  feet: ScreenPoint,
  pose: { liftPx: number; scaleX: number; scaleY: number; tilt: number; lift: number },
): void {
  const half = PAL_HOP_ROBIN_PX / 2;
  robin.style.transform =
    `translate3d(${feet.x - half}px, ${feet.y - PAL_HOP_ROBIN_PX - pose.liftPx}px, 0) ` +
    `rotate(${pose.tilt}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
  if (shadow) {
    shadow.style.transform = `translate3d(${feet.x - 18}px, ${feet.y - 5}px, 0) scale(${1 - 0.5 * pose.lift})`;
    shadow.style.opacity = String(0.55 - 0.3 * pose.lift);
  }
}

const STILL = { liftPx: 0, scaleX: 1, scaleY: 1, tilt: 0, lift: 0 };

/** Where the robin stands to say it found nothing: just off its button. */
function emptySpot(launch: ScreenPoint, viewport: ScreenBox): ScreenPoint {
  const half = PAL_HOP_ROBIN_PX / 2;
  return {
    x: Math.min(viewport.width - 10 - half, Math.max(10 + half, launch.x - 76)),
    y: Math.max(PAL_HOP_ROBIN_PX + 80, launch.y - 18),
  };
}

let autoStartSpent = false;

/**
 * What the address this page was opened at asked for: `?palhop=1` starts a
 * hop once the map settles, and `?palhop=slow` starts one at a quarter speed,
 * so a screenshot can catch the robin in the air. The map tidies its own
 * query string with history.replaceState before this control mounts, so the
 * navigation entry is read as well as the live address.
 */
function palHopAsked(): "1" | "slow" | null {
  const asked = (search: string) => {
    try {
      const value = new URLSearchParams(search).get(PAL_HOP_PARAM);
      return value === "1" || value === "slow" ? value : null;
    } catch {
      return null;
    }
  };
  const live = asked(window.location.search);
  if (live) return live;
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry ? asked(new URL(entry.name).search) : null;
  } catch {
    return null;
  }
}

function FootprintMark() {
  return (
    <svg viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
      <path
        d="M5 11.2V5.2M5 5.2 1.4 1.2M5 5.2V0.8M5 5.2 8.6 1.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PalHop({
  cityId,
  placement,
  onShowVenue,
  drinkLaneSelected = false,
  experienceView = null,
  peek = null,
}: PalHopProps) {
  const pintsOnMap = !drinkLaneSelected && (!experienceView || experienceView === "all");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [prints, setPrints] = useState<Print[]>([]);
  const [leaving, setLeaving] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const robinRef = useRef<HTMLSpanElement>(null);
  const shadowRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tailRef = useRef<HTMLSpanElement>(null);
  const runRef = useRef(0);
  const launchRef = useRef<ScreenPoint>({ x: 0, y: 0 });
  const beerRef = useRef<Promise<string | null> | null>(null);
  const leaveTimerRef = useRef(0);
  /** 1 at normal speed; 4 for `?palhop=slow`. */
  const slowRef = useRef(1);

  const land = useCallback(async (run: number, route: PalHopRoute) => {
    const beer = await (beerRef.current ?? Promise.resolve(null));
    if (runRef.current !== run) return;
    setPhase({ kind: "landed", run, route, answer: palHopAnswer(route.winner.stop, beer) });
  }, []);
  // The card's answer at the moment of the tap, without restarting the hop
  // every time the card re-renders.
  const peekRef = useRef(peek);
  useEffect(() => {
    peekRef.current = peek;
  }, [peek]);

  const begin = useCallback(async () => {
    window.clearTimeout(leaveTimerRef.current);
    const run = ++runRef.current;
    const rect = launcherRef.current?.getBoundingClientRect();
    const viewport = viewportBox();
    launchRef.current = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 + PAL_HOP_ROBIN_PX / 2 }
      : { x: viewport.width - 40, y: viewport.height - 160 };
    setPrints([]);
    setLeaving(false);
    setPhase({ kind: "looking", run });
    const reduced = prefersReducedMotion();

    const nothing = async (reason: PalHopEmptyReason) => {
      const area = reason === "unpriced" ? await nearestAreaOffer(cityId) : null;
      if (runRef.current !== run) return;
      const note = { reason, area };
      setPhase(reduced ? { kind: "empty", run, note } : { kind: "hopping", run, route: null, empty: note });
    };

    if (!pintsOnMap) return nothing("lens");
    const camera = readCamera();
    if (!camera) return nothing("unread");
    const rows = await readSlimRows(cityId, camera, viewport);
    if (runRef.current !== run) return;
    if (!rows) return nothing("unread");
    const stops = stopsInView(rows, project, mapRegion(placement, viewport));
    // The bottom card's pint, when it names one, is the answer. Should its
    // figure differ from the listed one (a price people logged since), the
    // robin says the card's figure and calls it people-logged.
    const card = peekPintWinner(peekRef.current);
    const named = card ? stops.find((stop) => stop.id === card.id) : undefined;
    if (named && card && Math.abs(named.priceGbp - card.priceGbp) > 0.005) {
      named.priceGbp = card.priceGbp;
      named.peopleLogged = true;
    }
    const route = palHopRoute(stops, paintedPoints(), { winnerId: named?.id ?? null });
    if (!route) return nothing("unpriced");
    beerRef.current = beerFor(route.winner.stop);
    if (reduced) return land(run, route);
    setPhase({ kind: "hopping", run, route, empty: null });
  }, [cityId, land, pintsOnMap, placement]);

  const close = useCallback(() => {
    runRef.current += 1;
    setLeaving(true);
    window.clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = window.setTimeout(() => {
      setPhase({ kind: "idle" });
      setPrints([]);
      setLeaving(false);
    }, prefersReducedMotion() ? 0 : LEAVE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(leaveTimerRef.current), []);

  // `?palhop=1`: start once the camera has settled with pins on screen (or
  // give up waiting after a minute and say what the robin can see).
  const beginRef = useRef(begin);
  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);
  useEffect(() => {
    const asked = autoStartSpent ? null : palHopAsked();
    if (!asked) return;
    if (asked === "slow") slowRef.current = 4;
    const started = performance.now();
    let steady = 0;
    let timer = 0;
    const poll = () => {
      if (autoStartSpent) return;
      // The phone shell stays mounted on a wide screen with its edge column
      // hidden, so only a button the reader can see starts the hop.
      if ((launcherRef.current?.getClientRects().length ?? 0) === 0) {
        timer = window.setTimeout(poll, 1_000);
        return;
      }
      const camera = readCamera();
      const pins = paintedPoints().filter((point) => point.kind === "pin");
      const ready = Boolean(camera && !camera.moving && !camera.settling && pins.length >= 3);
      steady = ready ? steady + 1 : 0;
      if (steady >= 3 || performance.now() - started > 60_000) {
        autoStartSpent = true;
        void beginRef.current();
        return;
      }
      timer = window.setTimeout(poll, 400);
    };
    timer = window.setTimeout(poll, 800);
    return () => window.clearTimeout(timer);
  }, []);

  // Escape sends the robin home.
  const out = phase.kind !== "idle";
  useEffect(() => {
    if (!out) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [out, close]);

  // Looking: the robin pops out onto its button while the prices are read.
  useLayoutEffect(() => {
    if (phase.kind !== "looking") return;
    const robin = robinRef.current;
    if (robin) placeRobin(robin, shadowRef.current, launchRef.current, STILL);
  }, [phase]);

  // The hops. One transform write per frame; the path is re-read from the
  // camera every frame, so a pan mid-hop carries the robin with its pins.
  useEffect(() => {
    if (phase.kind !== "hopping") return;
    const robin = robinRef.current;
    if (!robin) return;
    const { run, route, empty } = phase;
    const viewport = viewportBox();
    const launch = launchRef.current;
    const legs = route?.legs ?? [];
    const feetAt = (index: number): ScreenPoint => {
      if (index < 0) return launch;
      if (!route) return emptySpot(launch, viewport);
      return perchOn(legs[index]!.anchor, viewport);
    };
    const hops = route ? legs.length : 1;
    const slow = slowRef.current;
    let hop = 0;
    let hopStart = performance.now() + 140;
    let flightMs = 0;
    let arcPx = 0;
    let printKey = 0;
    let frame = 0;
    const tick = (now: number) => {
      const from = feetAt(hop - 1);
      const to = feetAt(hop);
      if (flightMs === 0) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        flightMs = palHopFlightMs(distance);
        arcPx = palHopArcPx(distance);
      }
      const pose = palHopPose((now - hopStart) / slow, flightMs);
      const feet = {
        x: from.x + (to.x - from.x) * pose.along,
        y: from.y + (to.y - from.y) * pose.along,
      };
      placeRobin(robin, shadowRef.current, feet, {
        liftPx: pose.lift * arcPx,
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
        tilt: Math.sign(to.x - from.x) * 10 * pose.lift,
        lift: pose.lift,
      });
      if (pose.done) {
        const fresh = palHopFootprints(from, to).map((print, index) => ({
          ...print,
          key: `${run}-${printKey++}`,
          delayMs: index * 70,
        }));
        if (fresh.length) setPrints((current) => [...current, ...fresh]);
        hop += 1;
        flightMs = 0;
        if (hop >= hops) {
          if (route) void land(run, route);
          else if (empty) setPhase({ kind: "empty", run, note: empty });
          return;
        }
        hopStart = now + PAL_HOP_PAUSE_MS * slow;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [phase, land]);

  // Landed (or empty-handed): the robin keeps to its pin while the reader
  // pans, and the bubble keeps to the robin, inside the screen.
  useLayoutEffect(() => {
    if (phase.kind !== "landed" && phase.kind !== "empty") return;
    const robin = robinRef.current;
    const bubble = bubbleRef.current;
    if (!robin || !bubble) return;
    const viewport = viewportBox();
    const box = { width: bubble.offsetWidth, height: bubble.offsetHeight };
    const winner = phase.kind === "landed" ? phase.route.winner : null;
    const still = emptySpot(launchRef.current, viewport);
    // Infinitely far away, so the first frame always places them.
    let lastX = Number.NEGATIVE_INFINITY;
    let lastY = Number.NEGATIVE_INFINITY;
    let frame = 0;
    const follow = () => {
      const feet = winner ? perchOn(winner.anchor, viewport) : still;
      if (Math.abs(feet.x - lastX) > 0.5 || Math.abs(feet.y - lastY) > 0.5) {
        lastX = feet.x;
        lastY = feet.y;
        placeRobin(robin, shadowRef.current, feet, STILL);
        const spot = palHopBubblePlacement(feet, box, viewport);
        bubble.style.transform = `translate3d(${spot.left}px, ${spot.top}px, 0)`;
        bubble.dataset.side = spot.above ? "above" : "below";
        if (tailRef.current) tailRef.current.style.left = `${spot.tailX}px`;
      }
      if (winner) frame = window.requestAnimationFrame(follow);
    };
    follow();
    return () => window.cancelAnimationFrame(frame);
  }, [phase]);

  const showMe = (stop: PalHopStop) => {
    close();
    // After the robin has gone, so the pub opens on a clear map. A pub with no
    // pin of its own on screen (gathered into a cluster) opens by its address.
    window.requestAnimationFrame(() => {
      if (onShowVenue) onShowVenue(stop.id);
      else if (!tapPaintedPin(stop)) {
        window.location.assign(cityAwareMapPath(cityId, new URLSearchParams({ sel: stop.id })));
      }
    });
  };

  const goToArea = (area: AreaOffer) => {
    close();
    window.location.assign(area.href);
  };

  const speaking = phase.kind === "landed" || phase.kind === "empty";
  const launcher = (
    <button
      ref={launcherRef}
      type="button"
      className={`palHopLauncher palHopLauncher--${placement}`}
      data-out={out ? "true" : undefined}
      data-testid="wild-pal-hop"
      aria-label={placement === "edge" ? "Find the cheapest" : undefined}
      title="Find the cheapest pint on screen"
      onClick={() => (out ? close() : void begin())}
    >
      <span className="palHopLauncherPerch" aria-hidden="true">
        <span className="palHopLauncherRobin" style={{ backgroundImage: ROBIN_SRC }} />
        <span className="palHopLauncherCoin">£</span>
      </span>
      {placement === "desktop" ? <span className="palHopLauncherText">Find the cheapest</span> : null}
    </button>
  );

  const stage = out ? (
    <div className="palHopStage" data-leaving={leaving ? "true" : undefined} data-phase={phase.kind}>
      {prints.map((print) => (
        <span
          key={print.key}
          className="palHopStep"
          aria-hidden="true"
          style={{
            left: print.x - 5,
            top: print.y - 6,
            rotate: `${print.angle + 90}deg`,
            animationDelay: `${print.delayMs}ms`,
          }}
        >
          <FootprintMark />
        </span>
      ))}
      <span ref={shadowRef} className="palHopShadow" aria-hidden="true" />
      <span ref={robinRef} className="palHopRobin" aria-hidden="true">
        <span
          className="palHopRobinBody"
          data-looking={phase.kind === "looking" ? "true" : undefined}
          style={{ backgroundImage: speaking ? ROBIN_TALK_SRC : ROBIN_SRC }}
        />
      </span>
      {phase.kind === "landed" ? (
        <div ref={bubbleRef} className="palHopBubbleAnchor">
          <div className="palHopBubble" role="status" aria-live="polite">
            <p className="palHopBubbleSay">Found it.</p>
            <p className="palHopBubbleKicker">{phase.answer.kicker}</p>
            <div className="palHopBubbleHead">
              {phase.route.winner.stop.peopleLogged ? (
                <PriceBadge variant="current" className="palHopBubblePrice">
                  {formatGbp(phase.route.winner.stop.priceGbp)}
                </PriceBadge>
              ) : (
                <PintPriceBadge
                  priceGbp={phase.route.winner.stop.priceGbp}
                  venueId={phase.route.winner.stop.id}
                  className="palHopBubblePrice"
                />
              )}
              <p className="palHopBubbleWhat">
                <span className="palHopBubbleDrink">{phase.answer.drink}</span>
                <span className="palHopBubblePub">at {phase.answer.pub}</span>
              </p>
            </div>
            <p className="palHopBubbleSource">{phase.answer.provenance}</p>
            <div className="palHopBubbleActions">
              <Button variant="primary" onClick={() => showMe(phase.route.winner.stop)}>
                <MapPin size={ICON_SIZE.inline} aria-hidden="true" />
                Show me
              </Button>
              <IconButton variant="ghost" aria-label="Send the Pal home" onClick={close}>
                <X size={ICON_SIZE.control} />
              </IconButton>
            </div>
          </div>
          <span ref={tailRef} className="palHopBubbleTail" aria-hidden="true" />
        </div>
      ) : null}
      {phase.kind === "empty" ? (
        <div ref={bubbleRef} className="palHopBubbleAnchor">
          <div className="palHopBubble" role="status" aria-live="polite">
            <p className="palHopBubbleSay">Hmm.</p>
            <p className="palHopBubbleLine">{palHopEmptyLine(phase.note.reason)}</p>
            <div className="palHopBubbleActions">
              {phase.note.area ? (
                <Button variant="secondary" onClick={() => goToArea(phase.note.area!)}>
                  <MapPin size={ICON_SIZE.inline} aria-hidden="true" />
                  Show me {phase.note.area.name}
                </Button>
              ) : null}
              <IconButton variant="ghost" aria-label="Send the Pal home" onClick={close}>
                <X size={ICON_SIZE.control} />
              </IconButton>
            </div>
          </div>
          <span ref={tailRef} className="palHopBubbleTail" aria-hidden="true" />
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      {placement === "desktop" ? createPortal(launcher, document.body) : launcher}
      {stage ? createPortal(stage, document.body) : null}
    </>
  );
}
