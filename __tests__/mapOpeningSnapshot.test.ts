import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { MAP_STYLES } from "@/components/map/canvas/tokens";
import { MAP_ARRIVAL_BEARING_DEG } from "@/lib/mapArrivalBearing";
import { MAP_OPENING_PREVIEW_CAMERA, projectAtCamera } from "@/lib/mapOpeningPreview";
import mapOpeningSnapshot from "@/lib/mapOpeningSnapshot.json";
import {
  groundRectCovers,
  largestCoveredTurn,
  MAP_OPENING_SNAPSHOT_MARGIN_PX,
  MAP_OPENING_SNAPSHOT_MAX_VIEWPORT,
  openingGroundRect,
  resolveOpeningGround,
  visibleGround,
  type MapOpeningSnapshotMeta,
} from "@/lib/mapOpeningSnapshot";

// THE OPENING BASEMAP PICTURE (lib/mapOpeningSnapshot.ts) IS A CAPTURE, AND A
// CAPTURE GOES STALE. These hold the committed pictures to the camera the map
// opens on, the styles it opens with and the phones it is shown on, so a change
// to any of them fails here until `npm run build:map-opening-snapshot` runs
// (scripts/build_map_opening_snapshot.mjs says how), rather than shipping a
// picture of the wrong streets under the opening prices.

const ROOT = process.cwd();
const meta = mapOpeningSnapshot as unknown as MapOpeningSnapshotMeta;
const REGENERATE = "stale: run npm run build:map-opening-snapshot (see scripts/build_map_opening_snapshot.mjs)";

/** The wire ceiling for one picture: it is fetched before the pins are. */
const MAX_PICTURE_BYTES = 120 * 1024;

describe("the committed opening basemap picture", () => {
  it("was captured for the camera a cold first visit opens on", () => {
    expect(meta.city, REGENERATE).toBe("london");
    expect(meta.camera, REGENERATE).toEqual({
      center: [...MAP_OPENING_PREVIEW_CAMERA.center],
      zoom: MAP_OPENING_PREVIEW_CAMERA.zoom,
      pitch: MAP_OPENING_PREVIEW_CAMERA.pitch,
      bearing: MAP_OPENING_PREVIEW_CAMERA.bearing,
    });
    expect(resolveOpeningGround(meta, MAP_OPENING_PREVIEW_CAMERA), REGENERATE).not.toBeNull();
  });

  it("was captured from the basemap styles the map opens with", () => {
    expect(meta.styles, REGENERATE).toEqual({ light: MAP_STYLES.light, dark: MAP_STYLES.dark });
  });

  it("covers the ground the largest supported phone sees, with its margin", () => {
    expect(meta.maxViewport, REGENERATE).toEqual(MAP_OPENING_SNAPSHOT_MAX_VIEWPORT);
    expect(meta.marginPx, REGENERATE).toBe(MAP_OPENING_SNAPSHOT_MARGIN_PX);
    expect(meta.ground, REGENERATE).toEqual(
      openingGroundRect(meta.camera.pitch, MAP_OPENING_SNAPSHOT_MAX_VIEWPORT, MAP_OPENING_SNAPSHOT_MARGIN_PX),
    );
  });

  it.each(["light", "dark"] as const)("ships the %s picture it records, inside the wire ceiling", async (theme) => {
    const image = meta.images[theme];
    expect(image.path).toBe(`/landing/map-opening/london-${theme}.webp`);
    const file = join(ROOT, "public", image.path);
    const bytes = readFileSync(file);
    expect(statSync(file).size).toBe(image.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.sha256);
    expect(image.bytes).toBeLessThanOrEqual(MAX_PICTURE_BYTES);
    const { format, width, height } = await sharp(bytes).metadata();
    expect(format).toBe("webp");
    expect(width).toBe(image.width);
    expect(height).toBe(image.height);
    // One picture pixel per world pixel at the recorded ratio, so the plane
    // lays it at world scale.
    expect(width).toBe(Math.round(meta.ground.width * meta.pixelRatio));
    expect(height).toBe(Math.round(meta.ground.height * meta.pixelRatio));
  });

  it("names each picture with its own content hash, so a regenerated one is never served from cache", () => {
    const ground = resolveOpeningGround(meta, MAP_OPENING_PREVIEW_CAMERA)!;
    expect(ground.light).toBe(`${meta.images.light.path}?v=${meta.images.light.sha256.slice(0, 12)}`);
    expect(ground.dark).toBe(`${meta.images.dark.path}?v=${meta.images.dark.sha256.slice(0, 12)}`);
    expect(ground.rect).toEqual(meta.ground);
  });
});

describe("where the picture may show", () => {
  it("is refused for any other camera, so a stale picture is never laid under the map", () => {
    const camera = MAP_OPENING_PREVIEW_CAMERA;
    expect(resolveOpeningGround(meta, { ...camera, zoom: camera.zoom + 0.5 })).toBeNull();
    expect(resolveOpeningGround(meta, { ...camera, pitch: camera.pitch + 1 })).toBeNull();
    expect(resolveOpeningGround(meta, { ...camera, bearing: -12 })).toBeNull();
    expect(resolveOpeningGround(meta, { ...camera, center: [camera.center[0] + 0.01, camera.center[1]] })).toBeNull();
  });

  it("leaves no edge on screen at any portrait phone size it is shown on", () => {
    const { width: maxW, height: maxH } = MAP_OPENING_SNAPSHOT_MAX_VIEWPORT;
    for (let width = 320; width <= maxW; width += 5) {
      for (let height = 560; height <= maxH; height += 4) {
        expect(groundRectCovers(meta.ground, meta.camera.pitch, width, height), `${width}x${height}`).toBe(true);
      }
    }
  });

  it("still covers the common iPhone screens through the arrival turn, and not the largest", () => {
    // The preview turns the picture with the map only where this holds, and
    // stands down where it does not (components/map/MapOpeningPreview.tsx).
    for (const [width, height] of [[375, 667], [390, 664], [390, 844], [393, 852]] as const) {
      for (const turn of [MAP_ARRIVAL_BEARING_DEG, -MAP_ARRIVAL_BEARING_DEG]) {
        expect(groundRectCovers(meta.ground, meta.camera.pitch, width, height, turn), `${width}x${height}`).toBe(true);
      }
    }
    expect(groundRectCovers(meta.ground, meta.camera.pitch, 440, 956, MAP_ARRIVAL_BEARING_DEG)).toBe(false);
  });

  it("holds the largest phones at the widest turn they still cover", () => {
    const { pitch } = meta.camera;
    expect(largestCoveredTurn(meta.ground, pitch, 390, 844, MAP_ARRIVAL_BEARING_DEG)).toBe(MAP_ARRIVAL_BEARING_DEG);
    for (const [width, height] of [[430, 932], [440, 956]] as const) {
      const held = largestCoveredTurn(meta.ground, pitch, width, height, MAP_ARRIVAL_BEARING_DEG);
      expect(held, `${width}x${height}`).toBeGreaterThan(0);
      expect(held, `${width}x${height}`).toBeLessThan(MAP_ARRIVAL_BEARING_DEG);
      expect(groundRectCovers(meta.ground, pitch, width, height, held), `${width}x${height}`).toBe(true);
    }
  });

  it("is the inverse of the projection the discs are laid with", () => {
    const camera = MAP_OPENING_PREVIEW_CAMERA;
    const worldSize = 512 * 2 ** camera.zoom;
    const groundToLngLat = (dx: number, dy: number): [number, number] => {
      const sin = Math.sin((camera.center[1] * Math.PI) / 180);
      const mercX = camera.center[0] / 360 + 0.5 + dx / worldSize;
      const mercY = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI + dy / worldSize;
      const lat = (360 * Math.atan(Math.exp(((180 - mercY * 360) * Math.PI) / 180))) / Math.PI - 90;
      return [(mercX - 0.5) * 360, lat];
    };
    for (const [width, height] of [[375, 667], [390, 844], [430, 932]] as const) {
      const seen = visibleGround(camera.pitch, width, height);
      const corners: [number, number, number, number][] = [
        [-seen.halfWidthTop, seen.top, 0, 0],
        [seen.halfWidthTop, seen.top, width, 0],
        [-seen.halfWidthBottom, seen.bottom, 0, height],
        [seen.halfWidthBottom, seen.bottom, width, height],
      ];
      for (const [dx, dy, x, y] of corners) {
        const [lng, lat] = groundToLngLat(dx, dy);
        const screen = projectAtCamera(lng, lat, camera, width, height);
        expect(screen.x).toBeCloseTo(x, 3);
        expect(screen.y).toBeCloseTo(y, 3);
      }
    }
  });

  it("is limited by the stylesheet to the viewport the picture covers", () => {
    const css = readFileSync(join(ROOT, "components/map/mapOpeningPreview.css"), "utf8");
    const init = readFileSync(join(ROOT, "public/theme-init.js"), "utf8");
    const { width, height } = MAP_OPENING_SNAPSHOT_MAX_VIEWPORT;
    // The pre-paint script measures the screen against the picture's own
    // numbers, and the stylesheet keeps it to portrait.
    expect(init).toContain(`window.innerWidth <= ${width} && window.innerHeight <= ${height}`);
    expect(init).toContain('document.documentElement.dataset.mapGround = "on"');
    expect(css).toContain("@media (orientation: portrait)");
    // Shown only while the preview is on, on a screen the picture covers, and
    // only where the document carries a picture at all.
    expect(css).toMatch(
      /html\[data-map-preview="on"\]\[data-map-ground="on"\]:has\(\.mapOpeningGround\) \.mapOpeningGround \{\s*display: block;/,
    );
    // Every plate the canvas stands on before it draws is see-through while
    // the picture shows, from the lazy chunk's plate to the map's own
    // container, by our class rather than the one MapLibre adds at build.
    const ground = 'html[data-map-preview="on"][data-map-ground="on"]:has(.mapOpeningGround)';
    for (const plate of [".mapCanvasSkeleton", ".mapCanvasWrap .maplibreMap"]) {
      expect(css).toContain(`${ground} ${plate}`);
    }
    expect(css).not.toContain(`${ground} .mapCanvasWrap .maplibregl-map`);
    // The loading line's glass holds still over the picture: its pour
    // repaints every frame, and each one drew the picture again.
    expect(css).toContain(
      `${ground} :is(.mapSkeleton, .mapLoading) :is(.pintLoaderFill, .pintLoaderBubble) {\n      animation: none;`,
    );
  });
});
