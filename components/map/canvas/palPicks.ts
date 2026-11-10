import * as maplibregl from "maplibre-gl";

import { palRecommendationPinOffsets } from "@/lib/palRecommendationMap";
import { readPalMapState, subscribePalMapState, type PalMapPick } from "@/lib/palMapCommands";
import { readTokens } from "./tokens";
import "./palPicks.css";

// The voice Pal's picks on the main map (lib/palMapCommands.ts). Numbered DOM
// markers, a bounded handful like the donut clusters, so a theme swap keeps
// them. One background layer on top of the style fades every other pin and the
// streets back, and the markers sit above the canvas. A tap opens the pick's
// venue sheet the way a pin tap does.

const SCRIM_LAYER = "pal-picks-scrim";
const SCRIM_OPACITY = 0.55;
const PROBE_KEY = "__pubmaxPalPicks";
const SVG_NS = "http://www.w3.org/2000/svg";

/** A painted pick, in viewport coordinates a tap can use. */
type PalPickProbePoint = { number: number; venueId: string; x: number; y: number };
type ProbeWindow = Window & {
  [PROBE_KEY]?: () => { sequence: number; scrim: boolean; picks: PalPickProbePoint[] };
};

type PalPicksOptions = {
  /** Frame the picks through the camera lane, once per answer. */
  frame: (sequence: number, picks: readonly PalMapPick[]) => void;
  open: (venueId: string) => void;
};

function scrimColour(): string {
  const tokens = readTokens();
  return document.documentElement.dataset.theme === "dark" ? tokens.inkDeep : tokens.paper;
}

export function installPalPicks(map: maplibregl.Map, { frame, open }: PalPicksOptions): () => void {
  let pins: { marker: maplibregl.Marker; line: SVGLineElement; dot: SVGCircleElement; button: HTMLButtonElement; pick: PalMapPick }[] = [];
  let rendered = -1;
  let painted = -1;
  let paintFrame: number | null = null;

  const syncScrim = () => {
    const wanted = pins.length > 0;
    map.getContainer().classList.toggle("palPicksActive", wanted);
    if (!map.getStyle()) return;
    if (wanted && !map.getLayer(SCRIM_LAYER)) {
      map.addLayer({
        id: SCRIM_LAYER,
        type: "background",
        paint: { "background-color": scrimColour(), "background-opacity": SCRIM_OPACITY },
      });
    } else if (!wanted && map.getLayer(SCRIM_LAYER)) {
      map.removeLayer(SCRIM_LAYER);
    }
  };

  const position = () => {
    const offsets = palRecommendationPinOffsets(pins.map(({ pick }) => map.project([pick.lng, pick.lat])));
    offsets.forEach((offset, index) => {
      const pin = pins[index]!;
      pin.button.style.left = `${offset.x}px`;
      pin.button.style.top = `${offset.y}px`;
      pin.line.setAttribute("x2", String(offset.x));
      pin.line.setAttribute("y2", String(offset.y));
      pin.dot.style.display = offset.x || offset.y ? "" : "none";
    });
  };

  const render = () => {
    const { sequence, picks } = readPalMapState();
    if (sequence === rendered) return;
    rendered = sequence;
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
    position();
    syncScrim();
    frame(sequence, picks);
    map.triggerRepaint();
    paintFrame = requestAnimationFrame(() => {
      paintFrame = requestAnimationFrame(() => {
        paintFrame = null;
        painted = sequence;
        performance.mark("pubmax:pal-picks-painted");
        window.dispatchEvent(new CustomEvent("pubmax:pal-picks-painted", { detail: { sequence, count: picks.length } }));
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
    scrim: Boolean(map.getStyle() && map.getLayer(SCRIM_LAYER)),
    picks: painted === rendered ? pins.map(({ pick, button }) => {
      const rect = button.getBoundingClientRect();
      return { number: pick.number, venueId: pick.venueId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }) : [],
  });

  return () => {
    unsubscribe();
    if (paintFrame !== null) cancelAnimationFrame(paintFrame);
    map.off("move", position);
    map.off("resize", position);
    map.off("style.load", onStyleLoad);
    pins.forEach((pin) => pin.marker.remove());
    pins = [];
    map.getContainer().classList.remove("palPicksActive");
    if (map.getStyle() && map.getLayer(SCRIM_LAYER)) map.removeLayer(SCRIM_LAYER);
    delete probeWindow[PROBE_KEY];
  };
}
