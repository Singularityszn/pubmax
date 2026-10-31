// THE OPENING BASEMAP, AS A PICTURE, BEFORE THE MAP ENGINE.
//
// The opening prices (lib/mapOpeningPreview.ts) are drawn by the document from
// the first paint, but they stood on the loading frame's paper until the engine
// painted its own basemap, 5 to 10 s later on a throttled phone. This is the
// ground under them: a picture of the opening London basemap, captured once by
// `npm run build:map-opening-snapshot` (scripts/build_map_opening_snapshot.mjs)
// and committed under public/landing/map-opening/.
//
// THE PICTURE IS FLAT, AND THE BROWSER TILTS IT. It is captured looking
// straight down (pitch 0, bearing 0) at the opening zoom, so one picture pixel
// per device pixel ratio is one world pixel there. The preview lays it on the
// same CSS plane as its discs, under the same perspective and pitch as the
// engine's camera, so every street lands where the engine will paint it at any
// phone size. A picture captured already tilted would match one viewport
// height only, because the engine's perspective distance is a multiple of it.
//
// This module is PURE geometry and a reader of the snapshot metadata; it never
// imports the metadata file itself, so the script that writes that file can
// run before one exists.

import { sameCameraPose, type OpeningCameraPose } from "@/lib/mapOpeningPreview";

/**
 * The largest viewport the picture covers, in CSS pixels. Every portrait phone
 * fits inside it; a larger viewport (a tablet, a desktop, a phone on its side)
 * gets no picture, which is the map as it opened before this existed.
 * components/map/mapOpeningPreview.css repeats these two numbers in its media
 * query, and __tests__/mapOpeningSnapshot.test.ts holds the two to one answer.
 */
export const MAP_OPENING_SNAPSHOT_MAX_VIEWPORT = { width: 440, height: 960 } as const;

/** Picture beyond the furthest visible ground, so no edge can show. */
export const MAP_OPENING_SNAPSHOT_MARGIN_PX = 24;

/** MapLibre's camera stands this many map heights from the point it looks at. */
const MAP_CAMERA_DISTANCE_IN_HEIGHTS = 1.5;

/** A rectangle on the ground, in world pixels at the camera's zoom, from its centre. */
export type GroundRect = { x: number; y: number; width: number; height: number };

type MapOpeningSnapshotImage = {
  /** Served path under public/, without the cache-busting query. */
  path: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
};

/** What lib/mapOpeningSnapshot.json records about the committed pictures. */
export type MapOpeningSnapshotMeta = {
  city: string;
  /** The camera the picture is drawn for: MAP_OPENING_PREVIEW_CAMERA when it was captured. */
  camera: OpeningCameraPose;
  /** The ground the picture covers. */
  ground: GroundRect;
  maxViewport: { width: number; height: number };
  marginPx: number;
  /** Picture pixels per world pixel. */
  pixelRatio: number;
  /** The basemap styles it was captured from (MAP_STYLES). */
  styles: { light: string; dark: string };
  images: { light: MapOpeningSnapshotImage; dark: MapOpeningSnapshotImage };
  capturedOn: string;
  attribution: string;
  regenerate: string;
};

/**
 * The ground a `width` x `height` map sees at `pitchDeg`, in world pixels from
 * the point the camera looks at: how far up (negative) and down it reaches, and
 * how wide it is at its top and bottom edges. The inverse of `projectAtCamera`
 * in lib/mapOpeningPreview.ts.
 */
export function visibleGround(
  pitchDeg: number,
  width: number,
  height: number,
): { top: number; bottom: number; halfWidthTop: number; halfWidthBottom: number } {
  const pitch = (pitchDeg * Math.PI) / 180;
  const distance = MAP_CAMERA_DISTANCE_IN_HEIGHTS * height;
  // A pitch this steep sees the horizon, and the ground has no top edge.
  if (distance * Math.cos(pitch) - (height / 2) * Math.sin(pitch) <= 0) {
    throw new Error(`A pitch of ${pitchDeg} degrees sees past the ground's far edge.`);
  }
  const groundY = (screenOffset: number) =>
    (screenOffset * distance) / (distance * Math.cos(pitch) + screenOffset * Math.sin(pitch));
  const halfWidthAt = (groundOffset: number) =>
    ((width / 2) * (distance - groundOffset * Math.sin(pitch))) / distance;
  const top = groundY(-height / 2);
  const bottom = groundY(height / 2);
  return { top, bottom, halfWidthTop: halfWidthAt(top), halfWidthBottom: halfWidthAt(bottom) };
}

/** The four corners of the ground a map sees, turned `turnDeg` about the point it looks at. */
function visibleGroundCorners(
  pitchDeg: number,
  width: number,
  height: number,
  turnDeg: number,
): Array<[number, number]> {
  const seen = visibleGround(pitchDeg, width, height);
  const turn = (turnDeg * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const corners: Array<[number, number]> = [
    [-seen.halfWidthTop, seen.top],
    [seen.halfWidthTop, seen.top],
    [-seen.halfWidthBottom, seen.bottom],
    [seen.halfWidthBottom, seen.bottom],
  ];
  return corners.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
}

/**
 * The ground rectangle a picture must cover so that no viewport up to
 * `viewport` sees its edge at `pitchDeg`, plus `margin` on every side. A
 * smaller viewport sees less on every side (the top width is a fixed multiple
 * of the viewport width, and the reach up and down grows with the height), so
 * covering the largest covers them all. It is drawn for a north-up screen: the
 * arrival turn keeps the picture only where `groundRectCovers` says the turned
 * screen still sees none of its edge, because covering every turned phone cost
 * the dark picture a fifth more bytes than its ceiling allows.
 */
export function openingGroundRect(
  pitchDeg: number,
  viewport: { width: number; height: number },
  margin: number,
): GroundRect {
  const seen = visibleGround(pitchDeg, viewport.width, viewport.height);
  const half = Math.ceil(Math.max(seen.halfWidthTop, seen.halfWidthBottom) + margin);
  const top = Math.floor(seen.top - margin);
  const bottom = Math.ceil(seen.bottom + margin);
  return { x: -half, y: top, width: half * 2, height: bottom - top };
}

/** Whether `rect` holds everything a `width` x `height` map sees at `pitchDeg`, turned `turnDeg`. */
export function groundRectCovers(
  rect: GroundRect,
  pitchDeg: number,
  width: number,
  height: number,
  turnDeg = 0,
): boolean {
  return visibleGroundCorners(pitchDeg, width, height, turnDeg).every(
    ([x, y]) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
  );
}

/**
 * The furthest the picture can turn toward `turnDeg` with a `width` x `height`
 * screen still seeing none of its edge, to a tenth of a degree. The whole turn
 * when it fits; less on a screen the turned picture would not cover (the
 * largest phones), where the preview holds at this rather than leave the
 * loading frame on bare paper, and the map's own frame takes the last degrees
 * at the handoff.
 */
export function largestCoveredTurn(
  rect: GroundRect,
  pitchDeg: number,
  width: number,
  height: number,
  turnDeg: number,
): number {
  if (groundRectCovers(rect, pitchDeg, width, height, turnDeg)) return turnDeg;
  const steps = Math.floor(Math.abs(turnDeg) * 10);
  for (let step = steps; step > 0; step -= 1) {
    const turn = Math.sign(turnDeg) * (step / 10);
    if (groundRectCovers(rect, pitchDeg, width, height, turn)) return turn;
  }
  return 0;
}

export type OpeningGround = {
  rect: GroundRect;
  /** Each theme's picture, with its content hash as the cache key. */
  light: string;
  dark: string;
};

function versionedUrl(image: MapOpeningSnapshotImage): string {
  return `${image.path}?v=${image.sha256.slice(0, 12)}`;
}

/**
 * The picture to lay under the opening preview, or null when the committed
 * snapshot was drawn for another camera than the one the map will open on, in
 * which case the map opens as it did before the picture existed.
 */
export function resolveOpeningGround(
  meta: MapOpeningSnapshotMeta,
  camera: OpeningCameraPose,
): OpeningGround | null {
  if (!sameCameraPose(meta.camera, camera)) return null;
  return { rect: meta.ground, light: versionedUrl(meta.images.light), dark: versionedUrl(meta.images.dark) };
}
