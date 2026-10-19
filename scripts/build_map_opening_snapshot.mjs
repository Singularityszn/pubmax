// The opening London basemap, captured as two pictures (light and dark) for the
// prerendered /map document to lay under its opening prices before the map
// engine paints (lib/mapOpeningSnapshot.ts owns the why and the geometry).
//
//   npm run build:map-opening-snapshot -- --base-url=http://127.0.0.1:4123
//
// The base URL is a PRODUCTION server of this tree (see e2e/AGENTS.md for a
// private-port one): `NEXT_DIST_DIR=.next-prod npm run build`, then
// `NEXT_DIST_DIR=.next-prod npx next start -p 4123`. It is asked for two things
// only: the app's own CSS, so the basemap wears the colours readTokens() reads
// on the live map, and the MapLibre worker module the app already serves.
// CHROMIUM_PATH names a Chromium when Playwright's own is not installed.
//
// WHAT IS CAPTURED, AND WHAT IS NOT. The basemap only: the OpenFreeMap style
// the map opens on (MAP_STYLES), with the app's basemap palette applied by the
// very function the canvas runs (applyBasemapTaste). No pub, no cluster, no
// landmark, no rail line and no chrome: those are the app's own layers, and a
// picture of a pin is a claim the picture cannot keep up to date.
//
// HOW. A bare MapLibre map, looking straight down (pitch 0, bearing 0) at the
// opening zoom, over the ground rectangle openingGroundRect() says the largest
// supported phone can see at the opening pitch, rendered at PIXEL_RATIO picture
// pixels per world pixel. The app's TypeScript modules are served to the page
// through Playwright's router, transpiled by the repo's own `typescript`, so
// this needs no bundler. Each picture is re-encoded as WebP through sharp at
// the highest quality that fits MAX_BYTES.
//
// WHEN TO RE-RUN. Whenever the opening camera (lib/cities.ts London mapView,
// MAP_OPENING_PREVIEW_CAMERA), the basemap styles (MAP_STYLES) or the basemap
// palette (lib/mapBasemapTaste.ts, the map tokens in app/globals.css) change.
// __tests__/mapOpeningSnapshot.test.ts fails on the first two until this runs;
// a stale picture for the camera is also refused at runtime and never shown.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";
import ts from "typescript";

import { MAP_STYLES } from "../components/map/canvas/tokens.ts";
import { MAP_OPENING_PREVIEW_CAMERA } from "../lib/mapOpeningPreview.ts";
import {
  MAP_OPENING_SNAPSHOT_MARGIN_PX,
  MAP_OPENING_SNAPSHOT_MAX_VIEWPORT,
  openingGroundRect,
} from "../lib/mapOpeningSnapshot.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IMAGE_DIR = join(ROOT, "public", "landing", "map-opening");
const META_PATH = join(ROOT, "lib", "mapOpeningSnapshot.json");

/**
 * Picture pixels per world pixel. Measured on the first capture (WebP, the
 * quality that fits): 2x was 152 KB light and 201 KB dark at the lowest
 * quality tried, because the dark style draws every building outline at this
 * zoom. 1.25x fits both under the ceiling at a quality that keeps labels clean;
 * it is soft on a 3x phone for the seconds it shows, and the engine's own
 * frame replaces it.
 */
const PIXEL_RATIO = 1.25;
/** The ceiling each picture is encoded under. It is on the wire before the pins are. */
const MAX_BYTES = 120 * 1024;
const QUALITIES = [72, 66, 60, 54, 48, 42, 38];
/** A page that loads the app's global CSS and little else. */
const TOKEN_PAGE = "/privacy";
const MODULE_PREFIX = "/__map-opening-snapshot/";
const WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const baseUrl = (argument("base-url") ?? process.env.BASE ?? "").replace(/\/$/, "");
if (!baseUrl) {
  console.error("Pass --base-url=http://127.0.0.1:<port>, a production server of this tree.");
  process.exit(2);
}

// --- The module server: the app's TypeScript, as browser ES modules. -------

const SOURCE_EXTENSIONS = [".ts", ".tsx", "/index.ts"];

function resolveSource(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : resolve(dirname(fromFile), specifier);
  for (const candidate of [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext)]) {
    if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve ${specifier} from ${relative(ROOT, fromFile)}`);
}

function moduleUrl(file) {
  return `${MODULE_PREFIX}src/${relative(ROOT, file).split(sep).join("/")}`;
}

function transpile(file) {
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      verbatimModuleSyntax: false,
    },
    fileName: file,
  });
  return outputText.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])([^"']+)\2/g, (match, lead, quote, specifier) => {
    if (specifier === "maplibre-gl") return `${lead}${quote}${MODULE_PREFIX}maplibre-gl.mjs${quote}`;
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      return `${lead}${quote}${moduleUrl(resolveSource(file, specifier))}${quote}`;
    }
    throw new Error(`${relative(ROOT, file)} imports ${specifier}, which the snapshot page cannot serve`);
  });
}

const ENTRY = `
import * as maplibregl from "${MODULE_PREFIX}maplibre-gl.mjs";
import { applyBasemapTaste } from "${moduleUrl(join(ROOT, "lib", "mapBasemapTaste.ts"))}";
import { readTokens } from "${moduleUrl(join(ROOT, "components", "map", "canvas", "tokens.ts"))}";

const frame = () => new Promise((done) => requestAnimationFrame(() => done()));

export async function capture({ style, dark, center, zoom, width, height, pixelRatio, workerUrl }) {
  maplibregl.setWorkerUrl(workerUrl);
  const host = document.createElement("div");
  host.id = "map-opening-snapshot";
  host.style.cssText = \`position:fixed;left:0;top:0;width:\${width}px;height:\${height}px;z-index:2147483647\`;
  document.body.append(host);
  const map = new maplibregl.Map({
    container: host,
    style,
    center,
    zoom,
    pitch: 0,
    bearing: 0,
    pixelRatio,
    interactive: false,
    fadeDuration: 0,
    attributionControl: { compact: false },
    canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
  });
  await new Promise((done, fail) => {
    map.once("load", done);
    map.once("error", (event) => fail(event.error ?? new Error("map error")));
  });
  // The palette the live canvas paints over the stock style (applySceneTaste
  // in components/map/canvas/buildScene.ts), from the same tokens.
  applyBasemapTaste(map, readTokens(), dark);
  map.triggerRepaint();
  for (let settled = 0; settled < 6; ) {
    await frame();
    settled = map.loaded() && map.areTilesLoaded() && !map.isMoving() ? settled + 1 : 0;
  }
  // One more full render, so the drawing buffer holds a finished frame.
  await new Promise((done) => {
    map.once("idle", done);
    map.triggerRepaint();
  });
  const canvas = map.getCanvas();
  const attribution = host.querySelector(".maplibregl-ctrl-attrib-inner")?.textContent ?? "";
  return {
    png: canvas.toDataURL("image/png").split(",")[1],
    width: canvas.width,
    height: canvas.height,
    attribution: attribution.replace(/\\s+/g, " ").trim(),
  };
}
`;

async function routeModules(page) {
  await page.route(`${baseUrl}${MODULE_PREFIX}**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice(MODULE_PREFIX.length);
    try {
      let body;
      if (path === "entry.mjs") body = ENTRY;
      else if (path === "maplibre-gl.mjs") {
        body = readFileSync(join(ROOT, "node_modules", "maplibre-gl", "dist", "maplibre-gl.mjs"), "utf8");
      } else if (path.startsWith("src/")) {
        const file = join(ROOT, path.slice(4));
        if (!file.startsWith(ROOT + sep)) throw new Error(`refused ${path}`);
        body = transpile(file);
      } else throw new Error(`no module ${path}`);
      await route.fulfill({ status: 200, contentType: "text/javascript", body });
    } catch (error) {
      console.error(`[snapshot] ${path}: ${error.message}`);
      await route.fulfill({ status: 500, contentType: "text/plain", body: String(error.message) });
    }
  });
}

// --- The capture. -----------------------------------------------------------

/** The point at a ground offset (world pixels at `zoom`) from `center`. */
function offsetCenter(center, zoom, dx, dy) {
  const worldSize = 512 * 2 ** zoom;
  const sin = Math.sin((center[1] * Math.PI) / 180);
  const mercX = center[0] / 360 + 0.5 + dx / worldSize;
  const mercY = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI + dy / worldSize;
  const lng = (mercX - 0.5) * 360;
  const lat = (360 * Math.atan(Math.exp(((180 - mercY * 360) * Math.PI) / 180))) / Math.PI - 90;
  return [lng, lat];
}

async function encode(png) {
  for (const quality of QUALITIES) {
    const webp = await sharp(png).webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    if (webp.length <= MAX_BYTES || quality === QUALITIES.at(-1)) return { webp, quality };
  }
  throw new Error("unreachable");
}

async function main() {
  const camera = MAP_OPENING_PREVIEW_CAMERA;
  const ground = openingGroundRect(camera.pitch, MAP_OPENING_SNAPSHOT_MAX_VIEWPORT, MAP_OPENING_SNAPSHOT_MARGIN_PX);
  const center = offsetCenter(camera.center, camera.zoom, ground.x + ground.width / 2, ground.y + ground.height / 2);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const images = {};
  let attribution = "";
  try {
    for (const theme of /** @type {const} */ (["light", "dark"])) {
      const context = await browser.newContext({
        viewport: { width: ground.width, height: ground.height },
        deviceScaleFactor: 1,
        colorScheme: theme,
        bypassCSP: true,
      });
      await context.addInitScript((value) => {
        try {
          localStorage.setItem("pubmax-theme", value);
        } catch {}
      }, theme);
      const page = await context.newPage();
      page.on("pageerror", (error) => console.warn(`[snapshot] page error: ${error.message}`));
      await routeModules(page);
      await page.goto(`${baseUrl}${TOKEN_PAGE}`, { waitUntil: "load" });
      const shot = await page.evaluate(
        async (args) => {
          const entry = await import(args.entryUrl);
          return entry.capture(args);
        },
        {
          entryUrl: `${baseUrl}${MODULE_PREFIX}entry.mjs`,
          style: MAP_STYLES[theme],
          dark: theme === "dark",
          center,
          zoom: camera.zoom,
          width: ground.width,
          height: ground.height,
          pixelRatio: PIXEL_RATIO,
          workerUrl: `${baseUrl}${WORKER_URL}`,
        },
      );
      if (shot.width !== ground.width * PIXEL_RATIO || shot.height !== ground.height * PIXEL_RATIO) {
        throw new Error(`${theme}: captured ${shot.width}x${shot.height}, expected the ground at ${PIXEL_RATIO}x`);
      }
      const { webp, quality } = await encode(Buffer.from(shot.png, "base64"));
      await mkdir(IMAGE_DIR, { recursive: true });
      const file = join(IMAGE_DIR, `london-${theme}.webp`);
      await writeFile(file, webp);
      images[theme] = {
        path: `/${relative(join(ROOT, "public"), file).split(sep).join("/")}`,
        bytes: webp.length,
        sha256: createHash("sha256").update(webp).digest("hex"),
        width: shot.width,
        height: shot.height,
      };
      attribution ||= shot.attribution;
      console.log(`[snapshot] ${theme}: ${shot.width}x${shot.height}, WebP q${quality}, ${(webp.length / 1024).toFixed(1)} KB`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const meta = {
    city: "london",
    camera: { center: [...camera.center], zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing },
    ground,
    maxViewport: { ...MAP_OPENING_SNAPSHOT_MAX_VIEWPORT },
    marginPx: MAP_OPENING_SNAPSHOT_MARGIN_PX,
    pixelRatio: PIXEL_RATIO,
    styles: { light: MAP_STYLES.light, dark: MAP_STYLES.dark },
    images,
    capturedOn: new Date().toISOString().slice(0, 10),
    attribution,
    regenerate: "npm run build:map-opening-snapshot -- --base-url=<a production server of this tree>",
  };
  await writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`[snapshot] wrote ${relative(ROOT, META_PATH)}`);
}

await main();
