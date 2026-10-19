import type * as maplibregl from "maplibre-gl";

import { isMapWebGlContextLost } from "@/components/map/canvas/webglRecovery";

/**
 * The map opens at one canvas pixel per CSS pixel, and draws at its full
 * ratio (`mapPixelRatio()` in webgl.ts) once the opening is over.
 *
 * Every frame of the opening (the basemap's first tiles, the 3-D massing, the
 * scene build, the pin reveal and the arrival turn) shades every canvas pixel.
 * At 2x a 390x664 phone stage is 780x1328; at 1x it is 390x664, a quarter of
 * the pixels. The opening is also the one stretch where the reader is waiting
 * for a picture rather than reading one, so it is where softness costs least.
 *
 * The switch waits for the opening to be OVER, never for a clock alone: the
 * pins have finished their entrance, the camera is still, the app owes it no
 * move (the arrival turn, the opening-location answer, a scheduled fly), and
 * no finger or pointer is on the map. `map.setPixelRatio` resizes the canvas,
 * and MapLibre's resize stops the camera's handlers, so a switch under a
 * finger would drop the gesture and one under a flight would hitch it.
 *
 * It never waits for ever. Past {@link FULL_RESOLUTION_CEILING_MS} from
 * construction only a moving camera or a pointer on the map holds it.
 */

/** The ratio the opening draws at on a screen whose full ratio is above it. */
export const OPENING_MAP_PIXEL_RATIO = 1;

/**
 * Past this, counted from construction, the map draws at its full ratio as
 * soon as the camera is still and nothing is touching it, whether or not the
 * pins have arrived or the arrival turn has been decided. The arrival turn's
 * own wait is 6s from the map being ready (lib/mapArrivalBearing.ts), and in
 * the throttled iPhone emulation the camera first came to rest 4.8 to 9.8s
 * after construction, so the ceiling sits above the slowest measured opening.
 */
export const FULL_RESOLUTION_CEILING_MS = 12_000;

/** How often the canvas asks whether the opening is over. */
export const FULL_RESOLUTION_POLL_MS = 200;

/**
 * The ratio a newly built map starts at. A screen at or below the opening
 * ratio starts where it ends. A map rebuilt after this canvas has already
 * reached its full ratio (a WebGL context rebuild, a Retry) starts there, so
 * a reader who was looking at a sharp map is never handed a soft one.
 */
export function openingMapPixelRatio(fullRatio: number, fullResolutionReached: boolean): number {
  if (fullResolutionReached) return fullRatio;
  return Math.min(fullRatio, OPENING_MAP_PIXEL_RATIO);
}

export type FullResolutionInput = {
  /** The ratio the map is drawing at now. */
  currentRatio: number;
  /** The ratio it should end at (`mapPixelRatio()`). */
  fullRatio: number;
  /** The pin entrance has finished (`pubmax:pin-entrance-settled`). */
  entranceSettled: boolean;
  /** MapLibre is running a gesture, an ease or a flight. */
  cameraMoving: boolean;
  /** The app still owes the camera a move of its own (cameraProbe.ts). */
  cameraOwed: boolean;
  /** A finger or pointer is down on the map. */
  pointerDown: boolean;
  /** The WebGL context is lost; a resize now would be dropped. */
  contextLost: boolean;
  /** Milliseconds since the map was constructed. */
  sinceConstructMs: number;
};

/** Whether the map should switch to its full ratio now. */
export function fullResolutionDue(input: FullResolutionInput): boolean {
  if (!(input.currentRatio < input.fullRatio)) return false;
  if (input.cameraMoving || input.pointerDown || input.contextLost) return false;
  if (input.entranceSettled && !input.cameraOwed) return true;
  return input.sinceConstructMs >= FULL_RESOLUTION_CEILING_MS;
}

const SPRITE_FILE = /(\.(?:json|png))$/;
const SPRITE_FILE_AT_2X = /@2x\.(?:json|png)$/;

/**
 * The sprite URL to fetch while the canvas is below its full ratio.
 *
 * MapLibre picks the basemap sprite (`ofm.png` or `ofm@2x.png`) from the
 * canvas ratio once, when the style loads, and `setPixelRatio` does not fetch
 * it again. A map that opened at 1x would keep 1x road shields and place dots
 * on a 2x canvas until the next theme swap. Asking for the @2x sheet from the
 * start keeps them as sharp as a map built at 2x, at the same bytes the 2x
 * opening already paid. Returns null when the URL should be left alone.
 */
export function spriteUrlForFullRatio(url: string, fullRatio: number): string | null {
  if (!(fullRatio > 1)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (SPRITE_FILE_AT_2X.test(parsed.pathname) || !SPRITE_FILE.test(parsed.pathname)) return null;
  parsed.pathname = parsed.pathname.replace(SPRITE_FILE, "@2x$1");
  return parsed.toString();
}

/** MapLibre `transformRequest` that keeps the basemap sprite at the full ratio. */
export function fullRatioSpriteRequest(fullRatio: number): maplibregl.RequestTransformFunction {
  return (url, resourceType) => {
    // MapLibre declares ResourceType as a const enum of these strings.
    const kind: string | undefined = resourceType;
    if (kind !== "SpriteJSON" && kind !== "SpriteImage") return undefined;
    const spriteUrl = spriteUrlForFullRatio(url, fullRatio);
    return spriteUrl ? { url: spriteUrl } : undefined;
  };
}

type FullResolutionOptions = {
  fullRatio: number;
  entranceSettled: () => boolean;
  cameraOwed: () => boolean;
  /** Called once, after the map has drawn its first frame at the full ratio. */
  onFullResolution: () => void;
};

/**
 * Switch `map` to its full ratio when the opening is over. Returns the
 * teardown. Does nothing when the map is already there.
 *
 * The switch runs at the top of an animation frame and draws that frame
 * itself (`map.redraw()`), because resizing a WebGL canvas clears it: from
 * inside MapLibre's own render, or between frames, the browser could present
 * the cleared canvas before MapLibre's next frame drew it again.
 */
export function armFullResolution(
  map: maplibregl.Map,
  { fullRatio, entranceSettled, cameraOwed, onFullResolution }: FullResolutionOptions,
): () => void {
  if (!(map.getPixelRatio() < fullRatio)) return () => {};
  const constructedAt = performance.now();
  const pointers = new Set<number>();
  const surface = map.getCanvasContainer();
  const onPointerDown = (event: PointerEvent) => pointers.add(event.pointerId);
  const onPointerUp = (event: PointerEvent) => pointers.delete(event.pointerId);
  surface.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);
  let frame: number | null = null;
  let done = false;

  const due = () =>
    fullResolutionDue({
      currentRatio: map.getPixelRatio(),
      fullRatio,
      entranceSettled: entranceSettled(),
      cameraMoving: map.isMoving(),
      cameraOwed: cameraOwed(),
      pointerDown: pointers.size > 0,
      contextLost: isMapWebGlContextLost(map),
      sinceConstructMs: performance.now() - constructedAt,
    });

  const teardown = () => {
    done = true;
    window.clearInterval(poll);
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    surface.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
  };

  const check = () => {
    if (done || frame !== null || !due()) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      // A gesture or a fly can start between the poll and the frame.
      if (done || !due()) return;
      teardown();
      map.setPixelRatio(fullRatio);
      map.redraw();
      onFullResolution();
    });
  };
  const poll = window.setInterval(check, FULL_RESOLUTION_POLL_MS);
  return teardown;
}
