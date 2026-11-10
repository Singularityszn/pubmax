import * as maplibregl from "maplibre-gl";

import { palRecommendationPinOffsets } from "@/lib/palRecommendationMap";
import { readPalMapState, subscribePalMapState, type PalMapPick } from "@/lib/palMapCommands";
import { PAL_PICKS_SCRIM_LAYER, raisePalPicksScrim } from "./palPicksScrim";
import { readTokens } from "./tokens";
import "./palPicks.css";

// The voice Pal's picks on the main map (lib/palMapCommands.ts). Numbered DOM
// markers, a bounded handful like the donut clusters, so a theme swap keeps
// them. One background layer on top of the style fades every other pin and the
// streets back, and the markers sit above the canvas. A tap opens the pick's
// venue sheet the way a pin tap does.

const SCRIM_OPACITY = 0.55;
const PROBE_KEY = "__pubmaxPalPicks";
const SVG_NS = "http://www.w3.org/2000/svg";

/** A painted pick, in viewport coordinates a tap can use. */
type PalPickProbePoint = { number: number; venueId: string; x: number; y: number };
type ProbeWindow = Window & {
  [PROBE_KEY]?: () => { sequence: number; scrim: boolean; speaking: number | null; picks: PalPickProbePoint[] };
};

type PalPicksOptions = {
  /** Frame the picks, or a move the person asked for (`asked`), through the camera lane, once each. */
  frame: (sequence: number, points: readonly { lng: number; lat: number }[], asked?: boolean) => void;
  open: (venueId: string) => void;
};

function scrimColour(): string {
  const tokens = readTokens();
  return document.documentElement.dataset.theme === "dark" ? tokens.inkDeep : tokens.paper;
}

export function installPalPicks(map: maplibregl.Map, { frame, open }: PalPicksOptions): () => void {
  let pins: { marker: maplibregl.Marker; line: SVGLineElement; dot: SVGCircleElement; button: HTMLButtonElement; pick: PalMapPick }[] = [];
  let rendered = -1;
  let moved = -1;
  let painted = -1;
  let paintFrame: number | null = null;
  const nativePaints = new Map<Element, number>();
  const recordPaint = (sequence: number, paintedAt: number) => {
    if (sequence !== rendered || painted === sequence) return;
    painted = sequence;
    performance.mark("pubmax:pal-picks-painted", { startTime: paintedAt });
    window.dispatchEvent(new CustomEvent("pubmax:pal-picks-painted", { detail: { sequence, count: pins.length } }));
  };
  const paintObserver = typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("element")
    ? new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const { element, renderTime } = entry as PerformanceEntry & { element: Element | null; renderTime: number };
        if (renderTime > 0 && pins.some(({ button }) => button === element)) nativePaints.set(element!, renderTime);
      }
      if (pins.length && nativePaints.size === pins.length) recordPaint(rendered, Math.max(...nativePaints.values()));
    }) : null;
  paintObserver?.observe({ type: "element", buffered: true });

  const syncScrim = () => {
    const wanted = pins.length > 0;
    map.getContainer().classList.toggle("palPicksActive", wanted);
    if (!map.getStyle()) return;
    if (wanted && !map.getLayer(PAL_PICKS_SCRIM_LAYER)) {
      map.addLayer({
        id: PAL_PICKS_SCRIM_LAYER,
        type: "background",
        paint: { "background-color": scrimColour(), "background-opacity": SCRIM_OPACITY },
      });
    } else if (!wanted && map.getLayer(PAL_PICKS_SCRIM_LAYER)) {
      map.removeLayer(PAL_PICKS_SCRIM_LAYER);
    }
    if (wanted) raisePalPicksScrim(map);
  };

  const position = () => {
    const container = map.getContainer();
    const offsets = palRecommendationPinOffsets(pins.map(({ pick }) => map.project([pick.lng, pick.lat])), {
      left: 22, right: container.clientWidth - 22,
      top: 22, bottom: container.clientHeight - 22,
    });
    offsets.forEach((offset, index) => {
      const pin = pins[index]!;
      pin.button.style.left = `${offset.x}px`;
      pin.button.style.top = `${offset.y}px`;
      pin.line.setAttribute("x2", String(offset.x));
      pin.line.setAttribute("y2", String(offset.y));
      pin.dot.style.display = offset.x || offset.y ? "" : "none";
    });
  };

  // The pick the Pal is naming pulses. Its pins and framing stay as they are.
  const syncFocus = () => {
    const { focused } = readPalMapState();
    for (const { button, pick } of pins) {
      button.toggleAttribute("data-speaking", pick.number === focused);
      if (pick.number === focused) {
        button.style.animation = "none";
        void button.offsetWidth;
        button.style.animation = "";
      }
    }
  };

  // An asked-for move frames once. A newer answer outranks an older move, so a
  // map that mounts mid-call frames whichever of the two came last.
  const syncView = () => {
    const { sequence, view } = readPalMapState();
    if (!view || view.sequence === moved) return;
    moved = view.sequence;
    if (view.sequence > sequence) frame(view.sequence, view.points, true);
  };

  const render = () => {
    const { sequence, picks } = readPalMapState();
    if (sequence === rendered) {
      syncFocus();
      return syncView();
    }
    rendered = sequence;
    nativePaints.clear();
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    performance.clearMarks("pubmax:pal-picks-painted");
    pins.forEach((pin) => pin.marker.remove());
    pins = picks.map((pick) => {
      const anchor = document.createElement("div");
      anchor.className = "palPickAnchor";
      const stem = document.createElementNS(SVG_NS, "svg");
      stem.setAttribute("viewBox", "-160 -160 320 320");
      stem.setAttribute("aria-hidden", "true");
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("y1", "0");
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("r", "3");
      stem.append(line, dot);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "palPick";
      button.setAttribute("elementtiming", `pal-pick-${sequence}-${pick.number}`);
      button.textContent = String(pick.number);
      button.setAttribute("aria-label", `${pick.number}. ${pick.name}`);
      button.dataset.venueId = pick.venueId;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        open(pick.venueId);
      });
      anchor.append(stem, button);
      const marker = new maplibregl.Marker({ element: anchor, anchor: "center" }).setLngLat([pick.lng, pick.lat]).addTo(map);
      return { marker, line, dot, button, pick };
    });
    syncFocus();
    position();
    syncScrim();
    frame(sequence, picks);
    syncView();
    map.triggerRepaint();
    paintFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        paintFrame = null;
        if (!paintObserver || !picks.length) recordPaint(sequence, performance.now());
      });
    });
  };

  // A theme swap rebuilds the style without the scrim. The markers are DOM and stay.
  const onStyleLoad = () => syncScrim();
  map.on("move", position);
  map.on("resize", position);
  map.on("style.load", onStyleLoad);
  const unsubscribe = subscribePalMapState(render);
  render();

  const probeWindow = window as ProbeWindow;
  probeWindow[PROBE_KEY] = () => ({
    sequence: painted,
    scrim: Boolean(map.getStyle() && map.getLayer(PAL_PICKS_SCRIM_LAYER)),
    speaking: pins.find(({ button }) => button.hasAttribute("data-speaking"))?.pick.number ?? null,
    picks: painted === rendered ? pins.map(({ pick, button }) => {
      const rect = button.getBoundingClientRect();
      return { number: pick.number, venueId: pick.venueId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }) : [],
  });

  return () => {
    unsubscribe();
    paintObserver?.disconnect();
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    map.off("move", position);
    map.off("resize", position);
    map.off("style.load", onStyleLoad);
    pins.forEach((pin) => pin.marker.remove());
    pins = [];
    map.getContainer().classList.remove("palPicksActive");
    if (map.getStyle() && map.getLayer(PAL_PICKS_SCRIM_LAYER)) map.removeLayer(PAL_PICKS_SCRIM_LAYER);
    delete probeWindow[PROBE_KEY];
  };
}
