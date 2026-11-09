import type * as maplibregl from "maplibre-gl";

import {
  MAP_ICON_SPECS,
  iconId,
  type IconSpec,
  type IconTokens,
} from "@/lib/mapIcons";
import { PINS_VISIBLE_EVENT } from "@/lib/performanceMarks";
import { discardBody } from "@/lib/responseBody";

import manifest from "./mapIconSprite.json";
import {
  MAP_ICON_PIXEL_RATIO,
  addDrawnMapIcon,
  iconTokensFor,
  mapIconImageOptions,
  readTokens,
} from "./tokens";

export type MapIconTheme = "light" | "dark";

type SpriteImage = { width: number; height: number; data: Uint8Array };

type SpriteState =
  | { status: "waiting" }
  | { status: "loading" }
  | { status: "ready"; images: ReadonlyMap<string, SpriteImage> }
  | { status: "failed"; reason: string };

type SpriteSheet = keyof typeof manifest.sheets;

const sprites = new Map<`${MapIconTheme}:${SpriteSheet}`, SpriteState>();
const SHEET_SPECS = {
  main: MAP_ICON_SPECS.filter((spec) => spec.ns !== "lm"),
  landmarks: MAP_ICON_SPECS.filter((spec) => spec.ns === "lm"),
};

const SPEC_BY_ID: ReadonlyMap<string, IconSpec> = new Map(
  MAP_ICON_SPECS.map((spec) => [iconId(spec.ns, spec.key), spec]),
);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decode the sprite PNG the build script writes: 8-bit RGBA, no interlace and
 * filter type None on every row. Anything else is refused rather than guessed
 * at, and a refusal sends the scene to the drawing fallback.
 */
export async function decodeSpritePng(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; data: Uint8Array }> {
  if (PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error("map icon sprite: not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      // bit depth 8, colour type RGBA, deflate, filter method 0, no interlace.
      if (data[8] !== 8 || data[9] !== 6 || data[10] || data[11] || data[12]) {
        throw new Error("map icon sprite: unsupported PNG format");
      }
    } else if (type === "IDAT") {
      idat.push(data);
      idatLength += data.length;
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const deflated = new Uint8Array(idatLength);
  let at = 0;
  for (const part of idat) {
    deflated.set(part, at);
    at += part.length;
  }
  const body = new Response(deflated).body;
  if (!body) throw new Error("map icon sprite: no stream");
  const raw = new Uint8Array(
    await new Response(body.pipeThrough(new DecompressionStream("deflate"))).arrayBuffer(),
  );
  const stride = width * 4;
  if (!width || !height || raw.length !== (stride + 1) * height) {
    throw new Error("map icon sprite: truncated PNG");
  }
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error("map icon sprite: filtered PNG row");
    pixels.set(raw.subarray(row + 1, row + 1 + stride), y * stride);
  }
  return { width, height, data: pixels };
}

/** Cut the atlas into one tightly packed RGBA buffer per icon id. */
function sliceSpriteAtlas(
  atlas: { width: number; height: number; data: Uint8Array },
  layout: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>,
): Map<string, SpriteImage> {
  const images = new Map<string, SpriteImage>();
  for (const [id, at] of Object.entries(layout)) {
    if (at.x + at.width > atlas.width || at.y + at.height > atlas.height) {
      throw new Error(`map icon sprite: ${id} lies outside the atlas`);
    }
    const data = new Uint8Array(at.width * at.height * 4);
    for (let row = 0; row < at.height; row++) {
      const from = ((at.y + row) * atlas.width + at.x) * 4;
      data.set(atlas.data.subarray(from, from + at.width * 4), row * at.width * 4);
    }
    images.set(id, { width: at.width, height: at.height, data });
  }
  return images;
}

async function loadSprite(
  theme: MapIconTheme,
  sheet: SpriteSheet,
): Promise<ReadonlyMap<string, SpriteImage>> {
  const entry = manifest.sheets[sheet];
  const response = await fetch(entry.themes[theme].url);
  if (!response.ok) {
    discardBody(response);
    throw new Error(`map icon sprite: HTTP ${response.status}`);
  }
  const atlas = await decodeSpritePng(new Uint8Array(await response.arrayBuffer()));
  if (atlas.width !== entry.width || atlas.height !== entry.height) {
    throw new Error("map icon sprite: atlas does not match its manifest");
  }
  return sliceSpriteAtlas(atlas, entry.icons);
}

function preloadSpriteSheet(theme: MapIconTheme, sheet: SpriteSheet): void {
  const key = `${theme}:${sheet}` as const;
  const state = sprites.get(key);
  if (state && state.status !== "waiting") return;
  if (
    typeof fetch !== "function" ||
    typeof Response !== "function" ||
    typeof DecompressionStream !== "function"
  ) {
    sprites.set(key, { status: "failed", reason: "unsupported" });
    return;
  }
  sprites.set(key, { status: "loading" });
  loadSprite(theme, sheet).then(
    (images) => sprites.set(key, { status: "ready", images }),
    (error: unknown) =>
      sprites.set(key, {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
      }),
  );
}

export function preloadMapIconSprite(theme: MapIconTheme): void {
  preloadSpriteSheet(theme, "main");
  const key = `${theme}:landmarks` as const;
  if (
    typeof performance !== "undefined" &&
    performance.getEntriesByName(PINS_VISIBLE_EVENT, "mark").length > 0
  ) {
    preloadSpriteSheet(theme, "landmarks");
  } else if (typeof window !== "undefined" && !sprites.has(key)) {
    sprites.set(key, { status: "waiting" });
    window.addEventListener(
      PINS_VISIBLE_EVENT,
      () => preloadSpriteSheet(theme, "landmarks"),
      { once: true },
    );
  }
}

type Rgba = readonly [number, number, number, number];

function parseColour(colour: string): Rgba | null {
  const value = colour.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex && hex.length !== 5 && hex.length !== 7) {
    const digits =
      hex.length <= 4 ? hex.split("").map((d) => d + d) : hex.match(/../g) ?? [];
    const [r = 0, g = 0, b = 0, a = 255] = digits.map((d) => parseInt(d, 16));
    return [r, g, b, a / 255];
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?)\s*)?\)$/.exec(
      value,
    );
  if (!rgb) return null;
  const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha];
}

/**
 * True when the live colours are the ones the atlas was drawn with. A channel
 * may differ by 2 of 255 and alpha by 0.02, because a browser may round a
 * computed color-mix() differently from the Chromium that drew the sprite, and
 * a difference that small draws the same icon. Anything else is a different
 * theme (the legacy legibility mode, a token changed without a rebuild), and
 * the scene draws instead.
 */
export function iconTokensMatch(
  drawnWith: Readonly<Record<string, string | undefined>>,
  live: IconTokens,
): boolean {
  const liveTokens: Readonly<Record<string, string | undefined>> = live;
  const keys = new Set([...Object.keys(drawnWith), ...Object.keys(liveTokens)]);
  for (const key of keys) {
    const a = drawnWith[key];
    const b = liveTokens[key];
    if (a === undefined || b === undefined) {
      if (a !== b) return false;
      continue;
    }
    if (a.trim().toLowerCase() === b.trim().toLowerCase()) continue;
    const ca = parseColour(a);
    const cb = parseColour(b);
    if (!ca || !cb) return false;
    for (let i = 0; i < 3; i++) if (Math.abs(ca[i]! - cb[i]!) > 2) return false;
    if (Math.abs(ca[3] - cb[3]) > 0.02) return false;
  }
  return true;
}

function spriteImageFor(
  theme: MapIconTheme,
  live: IconTokens,
  spec: IconSpec,
): SpriteImage | null {
  const sheet = spec.ns === "lm" ? "landmarks" : "main";
  const state = sprites.get(`${theme}:${sheet}`);
  if (state?.status !== "ready") return null;
  if (manifest.pixelRatio !== MAP_ICON_PIXEL_RATIO) return null;
  if (!iconTokensMatch(manifest.sheets[sheet].themes[theme].tokens, live)) return null;
  const image = state.images.get(iconId(spec.ns, spec.key));
  if (
    !image ||
    image.width !== spec.size * MAP_ICON_PIXEL_RATIO ||
    image.height !== (spec.height ?? spec.size) * MAP_ICON_PIXEL_RATIO
  ) {
    return null;
  }
  return image;
}

function registerMapIconsFromSprite(
  map: maplibregl.Map,
  theme: MapIconTheme,
  live: IconTokens,
  specs: readonly IconSpec[],
): boolean {
  const ready: Array<[IconSpec, SpriteImage]> = [];
  for (const spec of specs) {
    const image = spriteImageFor(theme, live, spec);
    if (!image) return false;
    ready.push([spec, image]);
  }
  for (const [spec, image] of ready) {
    const id = iconId(spec.ns, spec.key);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, image, mapIconImageOptions(spec));
  }
  return true;
}

type MapIconSource = "sprite" | "drawn";

export function registerSceneIconImages(
  map: maplibregl.Map,
  theme: MapIconTheme,
  live: IconTokens,
): MapIconSource {
  preloadMapIconSprite(theme);
  const mainReady = registerMapIconsFromSprite(map, theme, live, SHEET_SPECS.main);
  if (!mainReady) {
    for (const spec of SHEET_SPECS.main) addDrawnMapIcon(map, spec, live);
  }
  registerMapIconsFromSprite(map, theme, live, SHEET_SPECS.landmarks);
  return mainReady ? "sprite" : "drawn";
}

/**
 * The missing-image resolver's answer for one of OUR ids: the real icon, from
 * the sprite or drawn, never the transparent pixel a basemap miss gets.
 * Returns false for an id that is not
 * one of the designed icons.
 */
export function resolveMissingMapIcon(
  map: maplibregl.Map,
  id: string,
  theme: MapIconTheme,
): boolean {
  const spec = SPEC_BY_ID.get(id);
  if (!spec) return false;
  const live = iconTokensFor(readTokens(), theme === "dark");
  const image = spriteImageFor(theme, live, spec);
  if (image) map.addImage(id, image, mapIconImageOptions(spec));
  else addDrawnMapIcon(map, spec, live);
  return true;
}
