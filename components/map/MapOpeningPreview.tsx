"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";

import { donutFigureFontSize, DONUT_OUTER_RADIUS_LARGE } from "@/lib/donutClusterGeometry";
import {
  frameMatchesPreview,
  MAP_OPENING_FRAME_EVENT,
  MAP_OPENING_PREVIEW_CAMERA,
  MAP_OPENING_PREVIEW_DONE_MARK,
  MAP_OPENING_PREVIEW_RETRACT_EVENT,
  readPublishedOpeningFrame,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import type { OpeningGround } from "@/lib/mapOpeningSnapshot";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

import "./mapOpeningPreview.css";

// THE OPENING PRICES, DRAWN BY THE DOCUMENT (lib/mapOpeningPreview.ts owns the
// why). The discs ship in the prerendered /map HTML and show from the first
// paint, but only where public/theme-init.js has set
// `html[data-map-preview="on"]` before paint: a cold first visit, at /map with
// no query, with no remembered opening location. Hydration only adds the
// handoff: the preview stands down when the map reveals its own pins, or the
// moment the frame the map is about to draw differs from the one drawn here
// (the canvas publishes each one before its reveal, and this re-clusters it:
// another camera, another cluster, another count, another cheapest price or
// another band mix), or when the map says it cannot draw at all. It never
// re-appears.
//
// THE GROUND UNDER THEM (lib/mapOpeningSnapshot.ts) is a picture of the
// opening basemap, laid on the same camera, on a phone only. It sits UNDER the
// map stage, so the stage's chrome and loading line stay on top of it, and
// while it shows, the stage's loading paper is see-through and the canvas is
// held transparent (mapOpeningPreview.css). That is why the handoff after a reveal
// waits for the loading frame to lift: the canvas is covered until then, and
// standing down at the reveal itself put the loading frame back on screen for
// the 1.2 to 1.9 s the reveal took to unmount it (measured, 390x844, 4x CPU).
//
// The disc is the canvas's: neutral paper, a plain ring, "from" over the
// cheapest figure in that figure's own band ink (components/map/canvas/
// filters.ts, clusterLabelExpr). The "n pubs" caption under a canvas disc is
// left off: the map drops a caption where a neighbour is in its way, and the
// document cannot know which, so it draws none rather than one the map won't.

/** The ink a figure wears, by the band of the pub that says it. */
const FIGURE_INKS = [
  "var(--price-band-cheap-ink)",
  "var(--price-band-average-ink)",
  "var(--price-band-expensive-ink)",
] as const;

/** The map's own loading frame (MapLoadingFrame), over the canvas until the reveal unmounts it. */
const MAP_LOADING_FRAME_SELECTOR = ".mapLoading";
/** The longest the preview waits, after the reveal, for that frame to lift. */
const LOADING_FRAME_LIFT_CEILING_MS = 3000;

function standDown(): void {
  const root = document.documentElement;
  if (root.dataset.mapPreview !== "on") return;
  root.dataset.mapPreview = "done";
  try {
    performance.mark(MAP_OPENING_PREVIEW_DONE_MARK);
  } catch {
    // A timing mark is diagnostic only.
  }
}

/**
 * After the reveal, stand down in the frame the loading frame lifts off the
 * canvas, so the reader goes from the preview straight to the engine's own
 * frame. Returns the cleanup.
 */
function standDownWhenTheMapShows(): () => void {
  if (!document.querySelector(MAP_LOADING_FRAME_SELECTOR)) {
    standDown();
    return () => {};
  }
  let timer = 0;
  // A mutation callback runs before the next paint, so the frame that drops
  // the loading frame is the frame that drops the preview.
  const observer = new MutationObserver(() => {
    if (!document.querySelector(MAP_LOADING_FRAME_SELECTOR)) finish();
  });
  const finish = () => {
    observer.disconnect();
    window.clearTimeout(timer);
    standDown();
  };
  observer.observe(document.body, { childList: true, subtree: true });
  timer = window.setTimeout(finish, LOADING_FRAME_LIFT_CEILING_MS);
  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

export default function MapOpeningPreview({
  discs,
  ground = null,
}: {
  discs: readonly OpeningPreviewDisc[];
  ground?: OpeningGround | null;
}) {
  useEffect(() => {
    if (document.documentElement.dataset.mapPreview !== "on") return;
    // The map may already have revealed, or published, before this hydrated.
    if (performance.getEntriesByName(PINS_VISIBLE_EVENT).length > 0) {
      return standDownWhenTheMapShows();
    }
    let stopWaiting: (() => void) | null = null;
    const onReveal = () => {
      stopWaiting ??= standDownWhenTheMapShows();
    };
    const check = (frame: MapOpeningFrame | null) => {
      if (frame && !frameMatchesPreview(frame, discs)) standDown();
    };
    check(readPublishedOpeningFrame());
    const onFrame = (event: Event) => check((event as CustomEvent<MapOpeningFrame>).detail ?? null);
    window.addEventListener(PINS_VISIBLE_EVENT, onReveal);
    window.addEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, standDown);
    window.addEventListener(MAP_OPENING_FRAME_EVENT, onFrame);
    return () => {
      stopWaiting?.();
      window.removeEventListener(PINS_VISIBLE_EVENT, onReveal);
      window.removeEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, standDown);
      window.removeEventListener(MAP_OPENING_FRAME_EVENT, onFrame);
    };
  }, [discs]);

  if (discs.length === 0) return null;
  const pitch = `${MAP_OPENING_PREVIEW_CAMERA.pitch}deg`;
  return (
    <>
      {ground ? (
        <div
          className="mapOpeningGround"
          aria-hidden="true"
          style={
            {
              "--map-preview-pitch": pitch,
              "--ground-light": `url("${ground.light}")`,
              "--ground-dark": `url("${ground.dark}")`,
            } as CSSProperties
          }
        >
          <div className="mapOpeningPreviewCamera">
            <div className="mapOpeningPreviewPlane">
              <span
                className="mapOpeningGroundPicture"
                style={
                  {
                    "--x": `${ground.rect.x}px`,
                    "--y": `${ground.rect.y}px`,
                    "--w": `${ground.rect.width}px`,
                    "--h": `${ground.rect.height}px`,
                  } as CSSProperties
                }
              />
            </div>
          </div>
        </div>
      ) : null}
      <div
        className="mapOpeningPreview"
        aria-hidden="true"
        style={{ "--map-preview-pitch": pitch } as CSSProperties}
      >
        <div className="mapOpeningPreviewCamera">
        <div className="mapOpeningPreviewPlane">
          {discs.map((disc, index) => (
            <span
              key={disc.id}
              className="mapOpeningPreviewDisc"
              data-cluster-id={disc.id}
              style={
                {
                  "--x": `${disc.x}px`,
                  "--y": `${disc.y}px`,
                  "--figure-ink": FIGURE_INKS[disc.figureBand],
                  "--figure-size": `${donutFigureFontSize(disc.figure.length, DONUT_OUTER_RADIUS_LARGE)}px`,
                } as CSSProperties
              }
            >
              <span className="mapOpeningPreviewFrom">from</span>
              <span
                className="mapOpeningPreviewFigure"
                // The first price a reader sees, for the field and lab timings.
                {...(index === 0 ? { elementtiming: "map-first-price" } : {})}
              >
                {disc.figure}
              </span>
            </span>
          ))}
        </div>
        </div>
      </div>
    </>
  );
}
