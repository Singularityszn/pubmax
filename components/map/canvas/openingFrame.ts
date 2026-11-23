import * as maplibregl from "maplibre-gl";

import {
  MAP_OPENING_PREVIEW_DONE_MARK,
  MAP_OPENING_PREVIEW_RETRACT_EVENT,
  MAP_OPENING_PREVIEW_TURN_EVENT,
  openingTurnBearing,
  sameCameraPose,
  type OpeningCameraPose,
} from "@/lib/mapOpeningPreview";
import { opensOnCityCamera, PHONE_MAP_QUERY, PHONE_OPENING_PADDING } from "@/lib/phoneOpeningFrame";

type View = { center: readonly [number, number]; zoom: number; pitch?: number };

/** The maps that still hold their opening frame's padding. */
const heldOpeningFrames = new WeakSet<maplibregl.Map>();

/**
 * The opening frame of a map just built. On a phone, a map built on its city's
 * camera is padded to the free map (lib/phoneOpeningFrame.ts) before its first
 * frame, and keeps that padding until the app first moves the camera for
 * anything but the opening (`releaseOpeningFrame`). A reader's gesture keeps
 * it, because a release redraws the ground and a finger would feel the map
 * shift.
 *
 * Then it watches the camera for the document's opening preview. A camera that
 * moves while the preview is up (an opening location, a resumed view) is a
 * frame the preview did not draw, and it must not hang in place while the
 * ground slides under it: it stands down on the first frame the camera has
 * MOVED. The arrival turn is the exception: it only turns, and the preview
 * turns with it. Not on `movestart`, which `resize()` also fires with the
 * camera where it was: the phone's first resize stood the preview down within
 * half a second of construction on every cold visit, seconds before the reveal
 * (measured, 390x844, 4x CPU). Once the preview has stood down this listens no
 * more.
 */
export function holdOpeningFrame(map: maplibregl.Map, view: View, cityView: View): void {
  const phone = window.matchMedia(PHONE_MAP_QUERY);
  if (phone.matches && opensOnCityCamera(view, cityView)) {
    map.setPadding({ ...PHONE_OPENING_PADDING });
    heldOpeningFrames.add(map);
  }
  const poseOf = (): OpeningCameraPose => {
    const centre = map.getCenter();
    return {
      center: [centre.lng, centre.lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  };
  const constructedPose = poseOf();
  // Padding moves the picture without moving the centre.
  const paddingOf = () => JSON.stringify(map.getPadding());
  const constructedPadding = paddingOf();
  const onOpeningMove = () => {
    if (performance.getEntriesByName(MAP_OPENING_PREVIEW_DONE_MARK).length > 0) {
      map.off("move", onOpeningMove);
      phone.removeEventListener?.("change", onBreakpoint);
      return;
    }
    const pose = poseOf();
    const samePadding = paddingOf() === constructedPadding;
    if (sameCameraPose(pose, constructedPose) && samePadding) return;
    // The arrival turn only turns the camera, and the preview turns with it
    // rather than leaving the loading paper on screen until the reveal.
    const turned = samePadding ? openingTurnBearing(pose, constructedPose) : null;
    if (turned !== null) {
      window.dispatchEvent(new CustomEvent<number>(MAP_OPENING_PREVIEW_TURN_EVENT, { detail: turned }));
      return;
    }
    standDown();
  };
  // Turning the phone flips the preview's CSS offset; the padding must follow,
  // and the preview no longer matches the map, so it stands down.
  const onBreakpoint = () => {
    standDown();
    releaseOpeningFrame(map);
  };
  const standDown = () => {
    map.off("move", onOpeningMove);
    phone.removeEventListener?.("change", onBreakpoint);
    if (performance.getEntriesByName(MAP_OPENING_PREVIEW_DONE_MARK).length > 0) return;
    window.dispatchEvent(new Event(MAP_OPENING_PREVIEW_RETRACT_EVENT));
  };
  map.on("move", onOpeningMove);
  phone.addEventListener?.("change", onBreakpoint);
}

/**
 * Hands a padded opening camera back to the canvas middle, just before a move
 * the app makes (components/map/canvas/useMapCamera.ts), because every such
 * move aims at the canvas middle. The ground at the canvas middle becomes the
 * centre, at the zoom that draws it the same height, so the move starts from
 * nearly the frame on screen: padding tilts the view a few degrees, which no
 * unpadded camera at the same pitch can match exactly, and the rest is a few
 * pixels at the screen edges as the move begins.
 */
export function releaseOpeningFrame(map: maplibregl.Map): void {
  if (!heldOpeningFrames.delete(map)) return;
  const container = map.getContainer();
  const x = container.clientWidth / 2;
  const y = container.clientHeight / 2;
  const span = 40;
  const above = maplibregl.MercatorCoordinate.fromLngLat(map.unproject([x, y - span]));
  const below = maplibregl.MercatorCoordinate.fromLngLat(map.unproject([x, y + span]));
  const groundPx = Math.hypot(below.x - above.x, below.y - above.y) * 512 * 2 ** map.getZoom();
  // An unpadded camera draws a world pixel at its centre cos(pitch) pixels tall.
  const cosPitch = Math.cos((map.getPitch() * Math.PI) / 180);
  const zoom = map.getZoom() + Math.log2((2 * span) / (groundPx * cosPitch));
  map.jumpTo({
    center: map.unproject([x, y]),
    zoom: Number.isFinite(zoom) ? zoom : map.getZoom(),
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
}
