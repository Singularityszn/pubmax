"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";

import { donutFigureFontSize, DONUT_OUTER_RADIUS_LARGE } from "@/lib/donutClusterGeometry";
import {
  frameCameraMatchesPreview,
  frameMatchesPreview,
  MAP_OPENING_FRAME_EVENT,
  MAP_OPENING_PREVIEW_CAMERA,
  MAP_OPENING_PREVIEW_DONE_MARK,
  MAP_OPENING_PREVIEW_RETRACT_EVENT,
  MAP_OPENING_PREVIEW_TURN_EVENT,
  readPublishedOpeningFrame,
  type MapOpeningFrame,
} from "@/lib/mapOpeningPreview";
import type { OpeningPreviewDisc } from "@/lib/mapOpeningPreviewDiscs";
import { largestCoveredTurn, type OpeningGround } from "@/lib/mapOpeningSnapshot";
import { BASEMAP_DRAWN_EVENT, PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";

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
// It also waits for the streets in view to be drawn, or the pins stood on bare
// paper while the street tiles were still arriving.
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
/** The longest the preview waits, after the reveal, for the streets to be drawn. */
const MAP_SHOWS_CEILING_MS = 3000;
/**
 * The longest it waits, after the reveal, for anything. The loading frame is
 * the shell's to lift and the shell bounds that itself
 * (MAP_CANVAS_READINESS_CEILING_MS), so this only stops a preview outliving a
 * frame that somehow never goes.
 */
const MAP_SHOWS_BACKSTOP_MS = 10_000;

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
 * After the reveal, stand down in the frame the map is there to be seen: the
 * loading frame has lifted off the canvas AND the streets in view are drawn
 * (BASEMAP_DRAWN_EVENT). Standing down on the lift alone showed the engine's
 * pins on bare paper while its street tiles were still arriving, a blank
 * frame between the picture and the map.
 *
 * The streets have a ceiling, for a map whose tiles fail: after
 * MAP_SHOWS_CEILING_MS the lift alone will do. The lift has none of its own,
 * because standing down while the loading frame is still up shows that frame
 * on bare paper, which is never better than the picture: a busy phone took
 * 3.1 to 3.6 s to lift it after the reveal and showed exactly that.
 * MAP_SHOWS_BACKSTOP_MS is the last word. Returns the cleanup.
 */
function standDownWhenTheMapShows(): () => void {
  const frameLifted = () => !document.querySelector(MAP_LOADING_FRAME_SELECTOR);
  const streetsDrawn = () => performance.getEntriesByName(BASEMAP_DRAWN_EVENT).length > 0;
  if (frameLifted() && streetsDrawn()) {
    standDown();
    return () => {};
  }
  let streetsWaived = false;
  let ceiling = 0;
  let backstop = 0;
  // A mutation callback runs before the next paint, and the streets mark is
  // set inside the engine's own render, so either way the frame that shows
  // the map is the frame that drops the preview.
  const check = () => {
    if (frameLifted() && (streetsDrawn() || streetsWaived)) finish();
  };
  const observer = new MutationObserver(check);
  const stop = () => {
    observer.disconnect();
    window.removeEventListener(BASEMAP_DRAWN_EVENT, check);
    window.clearTimeout(ceiling);
    window.clearTimeout(backstop);
  };
  const finish = () => {
    stop();
    standDown();
  };
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener(BASEMAP_DRAWN_EVENT, check);
  ceiling = window.setTimeout(() => {
    streetsWaived = true;
    check();
  }, MAP_SHOWS_CEILING_MS);
  backstop = window.setTimeout(finish, MAP_SHOWS_BACKSTOP_MS);
  return stop;
}

/**
 * How many previews are mounted. The document's preview belongs to the cold
 * first load only, so leaving /map before the handoff stands it down: on a
 * return through the app's own navigation the root still says "on", and the
 * marks the first map left (`pubmax:pins-visible`, and the streets mark the
 * canvas clears for each new map) would hand over a frame no map has drawn.
 * Counted rather than flagged so React's development double mount, which
 * unmounts and mounts again in the same turn, is not a departure.
 */
let mountedPreviews = 0;

export default function MapOpeningPreview({
  discs,
  ground = null,
}: {
  discs: readonly OpeningPreviewDisc[];
  ground?: OpeningGround | null;
}) {
  useEffect(() => {
    mountedPreviews += 1;
    return () => {
      mountedPreviews -= 1;
      window.setTimeout(() => {
        if (mountedPreviews === 0) standDown();
      }, 0);
    };
  }, []);

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
      if (!frame || frameMatchesPreview(frame, discs)) return;
      // The map will draw other prices from the same camera (a fuller venue
      // index has landed): the discs go, but the picture under them is still
      // the ground the map draws, so it stays until the map shows. Leaving it
      // put the loading frame back on bare paper until the reveal.
      if (
        ground &&
        document.documentElement.dataset.mapGround === "on" &&
        frameCameraMatchesPreview(frame)
      ) {
        document.documentElement.dataset.mapPreviewDiscs = "off";
        return;
      }
      standDown();
    };
    check(readPublishedOpeningFrame());
    const onFrame = (event: Event) => check((event as CustomEvent<MapOpeningFrame>).detail ?? null);
    // The arrival turn: the picture and the discs turn with the camera, so the
    // ground stays under the reader instead of the loading paper. The picture
    // is drawn for a north-up screen, so on a screen whose turned corners
    // would see past its edge (the largest phones) it turns only as far as it
    // still covers, and the map's own frame takes the last degree or two at
    // the handoff. Standing down there left the loading frame on bare paper
    // for 2 to 3 s until the reveal.
    const onTurn = (event: Event) => {
      const bearing = (event as CustomEvent<number>).detail;
      if (typeof bearing !== "number" || !Number.isFinite(bearing)) return;
      let turn = bearing - MAP_OPENING_PREVIEW_CAMERA.bearing;
      if (ground && document.documentElement.dataset.mapGround === "on") {
        turn = largestCoveredTurn(
          ground.rect,
          MAP_OPENING_PREVIEW_CAMERA.pitch,
          window.innerWidth,
          window.innerHeight,
          turn,
        );
      }
      document.documentElement.style.setProperty("--map-preview-bearing", `${turn}deg`);
    };
    window.addEventListener(PINS_VISIBLE_EVENT, onReveal);
    window.addEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, standDown);
    window.addEventListener(MAP_OPENING_PREVIEW_TURN_EVENT, onTurn);
    window.addEventListener(MAP_OPENING_FRAME_EVENT, onFrame);
    return () => {
      stopWaiting?.();
      window.removeEventListener(PINS_VISIBLE_EVENT, onReveal);
      window.removeEventListener(MAP_OPENING_PREVIEW_RETRACT_EVENT, standDown);
      window.removeEventListener(MAP_OPENING_PREVIEW_TURN_EVENT, onTurn);
      window.removeEventListener(MAP_OPENING_FRAME_EVENT, onFrame);
    };
  }, [discs, ground]);

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
