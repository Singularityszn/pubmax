#!/usr/bin/env node
// Draws every designed map icon ONCE, at build time, into one sprite per theme.
//
//   npm run build:map-icon-sprites           draw and write the sprites
//   npm run build:map-icon-sprites -- --check  exit 1 when the sprites are stale
//
// The map used to draw all of MAP_ICON_SPECS in the browser on every style
// load: a canvas per icon, its paths, then a getImageData read-back, which is
// the slow call on a phone. Measured on a production build, iPhone 14 emulation
// at 4x CPU: 137 to 160 ms of main thread in light and 211 to 274 ms in dark,
// once per open and again on every theme swap. The scene now registers these
// pre-drawn pixels instead (components/map/canvas/iconSprite.ts) and draws only
// as a fallback.
//
// NOTHING IS RETYPED. Chromium runs the REAL draw functions (lib/mapIcons.ts)
// with the REAL colour recipe (iconTokensFor and readTokens in
// components/map/canvas/tokens.ts) over the REAL stylesheets (app/globals.css,
// app/theme.css), served to it as they are. The PNG is encoded here, from the
// bytes the canvas read back, so the sprite holds exactly the pixels the old
// path handed MapLibre.
//
// Writes:
//   public/map-icons/{light,dark}.png   the atlases, 2x
//   public/map-icons/{light,dark}.json  the same layout as a MapLibre sprite index
//   components/map/canvas/mapIconSprite.json  the manifest the runtime imports:
//     the input fingerprint, the colours each atlas was drawn with, the layout,
//     and a sha256 of the decoded pixels the fence test checks the decoder against.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { chromium } from "@playwright/test";
import ts from "typescript";

import {
  MAP_ICON_SPRITE_FORMAT,
  MAP_ICON_TOKEN_CSS_FILES,
  MAP_ICON_TOKEN_CSS_PROPERTIES,
  mapIconSpriteFingerprint,
} from "./lib/mapIconSpriteFingerprint.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "components/map/canvas/mapIconSprite.json";
const OUT_DIR = "public/map-icons";
const THEMES = ["light", "dark"];
/** Atlas row width in image pixels, and the gap between icons. */
const ATLAS_MAX_WIDTH = 640;
const GAP = 2;

const check = process.argv.includes("--check");
const fingerprint = mapIconSpriteFingerprint(ROOT);

if (check) {
  const manifestPath = join(ROOT, MANIFEST);
  const current = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).fingerprint
    : null;
  if (current !== fingerprint) {
    console.error(
      `Map icon sprites are stale (manifest ${current ?? "missing"}, inputs ${fingerprint}). ` +
        "Run npm run build:map-icon-sprites and commit the result.",
    );
    process.exit(1);
  }
  console.log(`Map icon sprites are current (${fingerprint.slice(0, 12)}).`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Serve the tree to the page. Every .ts module is transpiled on request with
// the repo's own TypeScript and its `@/` imports pointed back at this origin,
// so the browser resolves the same module graph the app bundles.
// ---------------------------------------------------------------------------
const ORIGIN = "http://map-icon-sprite.build";

function moduleSource(path) {
  const file = join(ROOT, path);
  const out = ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return out.replace(/from\s+"@\/([^"]+)"/g, (_m, spec) =>
    `from "/${spec.endsWith(".ts") ? spec : `${spec}.ts`}"`,
  );
}

function stylesheet() {
  // The token blocks are plain CSS. The Tailwind @imports are build-pipeline
  // input the browser cannot resolve here and no icon token lives in them.
  return MAP_ICON_TOKEN_CSS_FILES.map((file) =>
    readFileSync(join(ROOT, file), "utf8").replace(/^@import[^;]*;/gm, ""),
  ).join("\n");
}

function page(theme) {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${stylesheet()}</style></head><body>
<script type="module">
import { MAP_ICON_SPECS, iconId, rasterize } from "/lib/mapIcons.ts";
import { iconTokensFor, readTokens, MAP_ICON_PIXEL_RATIO } from "/components/map/canvas/tokens.ts";
const properties = ${JSON.stringify(Object.values(MAP_ICON_TOKEN_CSS_PROPERTIES))};
const base64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
window.__drawSprite = () => {
  const styles = getComputedStyle(document.documentElement);
  const unresolved = properties.filter((p) => !styles.getPropertyValue(p).trim());
  const tokens = iconTokensFor(readTokens(), document.documentElement.dataset.theme === "dark");
  const icons = MAP_ICON_SPECS.map((spec) => {
    const image = rasterize(spec, tokens, MAP_ICON_PIXEL_RATIO);
    return { id: iconId(spec.ns, spec.key), width: image.width, height: image.height,
      stretch: spec.stretch ?? null, rgba: base64(new Uint8Array(image.data.buffer)) };
  });
  return { pixelRatio: MAP_ICON_PIXEL_RATIO, unresolved, tokens, icons };
};
window.__ready = true;
</script></body></html>`;
}

async function drawTheme(browser, theme) {
  const context = await browser.newContext();
  const tab = await context.newPage();
  const errors = [];
  tab.on("pageerror", (error) => errors.push(error.message));
  await tab.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/index.html") {
      return route.fulfill({ contentType: "text/html", body: page(theme) });
    }
    if (path.endsWith(".ts") && existsSync(join(ROOT, path.slice(1)))) {
      return route.fulfill({
        contentType: "text/javascript",
        body: moduleSource(path.slice(1)),
      });
    }
    return route.fulfill({ status: 404, body: "" });
  });
  await tab.goto(`${ORIGIN}/index.html`);
  await tab.waitForFunction(() => window.__ready === true || false, null, {
    timeout: 20_000,
  }).catch(() => {
    throw new Error(`The ${theme} sprite page never loaded: ${errors.join("; ")}`);
  });
  const drawn = await tab.evaluate(() => window.__drawSprite());
  await context.close();
  if (errors.length) throw new Error(`${theme}: ${errors.join("; ")}`);
  if (drawn.unresolved.length) {
    // readTokens falls back to a hard-coded colour when a property is empty, and
    // a sprite drawn from fallbacks would be wrong without saying so.
    throw new Error(`${theme}: no value for ${drawn.unresolved.join(", ")}`);
  }
  return drawn;
}

// ---------------------------------------------------------------------------
// Packing: shelf rows in MAP_ICON_SPECS order. Deterministic, so the layout
// is identical in both themes and only changes when the specs do.
// ---------------------------------------------------------------------------
function pack(icons) {
  const layout = {};
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const icon of icons) {
    if (x > 0 && x + icon.width > ATLAS_MAX_WIDTH) {
      x = 0;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    layout[icon.id] = { x, y, width: icon.width, height: icon.height };
    x += icon.width + GAP;
    rowHeight = Math.max(rowHeight, icon.height);
    width = Math.max(width, x - GAP);
  }
  return { layout, width, height: y + rowHeight };
}

// ---------------------------------------------------------------------------
// PNG: 8-bit RGBA, no interlace, no colour chunks, and filter type None on
// every row. None is not only the cheapest to decode (the runtime inflates and
// copies rows, components/map/canvas/iconSprite.ts decodeSpritePng), it is also
// the SMALLEST here: measured on this atlas, light 60.4 KB with None against
// 75.4 KB adaptive, 77.3 KB Up and 81.6 KB Paeth, and dark 68.7 KB against 87.1.
// The anti-aliased edges defeat the predictors, the transparent runs do not
// need them.
// ---------------------------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // raw[y * (stride + 1)] stays 0: filter type None.
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const drawnByTheme = {};
try {
  for (const theme of THEMES) drawnByTheme[theme] = await drawTheme(browser, theme);
} finally {
  await browser.close();
}

const { layout, width, height } = pack(drawnByTheme.light.icons);
const manifest = {
  note: "Generated by npm run build:map-icon-sprites. Do not edit by hand.",
  format: MAP_ICON_SPRITE_FORMAT,
  fingerprint,
  pixelRatio: drawnByTheme.light.pixelRatio,
  width,
  height,
  themes: {},
  icons: layout,
};
mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
for (const theme of THEMES) {
  const drawn = drawnByTheme[theme];
  const atlas = Buffer.alloc(width * height * 4);
  const index = {};
  for (const icon of drawn.icons) {
    const at = layout[icon.id];
    if (!at || at.width !== icon.width || at.height !== icon.height) {
      throw new Error(`${theme}: ${icon.id} does not match the light layout`);
    }
    const pixels = Buffer.from(icon.rgba, "base64");
    for (let row = 0; row < icon.height; row++) {
      pixels.copy(
        atlas,
        ((at.y + row) * width + at.x) * 4,
        row * icon.width * 4,
        (row + 1) * icon.width * 4,
      );
    }
    const r = drawn.pixelRatio;
    index[icon.id] = {
      ...at,
      pixelRatio: r,
      ...(icon.stretch
        ? {
            stretchX: icon.stretch.x.map(([a, b]) => [a * r, b * r]),
            stretchY: icon.stretch.y.map(([a, b]) => [a * r, b * r]),
            content: icon.stretch.content.map((n) => n * r),
          }
        : {}),
    };
  }
  const png = encodePng(width, height, atlas);
  writeFileSync(join(ROOT, OUT_DIR, `${theme}.png`), png);
  writeFileSync(join(ROOT, OUT_DIR, `${theme}.json`), `${JSON.stringify(index, null, 2)}\n`);
  manifest.themes[theme] = {
    url: `/map-icons/${theme}.png?v=${sha256(png).slice(0, 12)}`,
    pixelsSha256: sha256(atlas),
    tokens: drawn.tokens,
  };
  console.log(
    `${theme}: ${drawn.icons.length} icons, ${width}x${height} atlas, ${(png.length / 1024).toFixed(1)} KB`,
  );
}
writeFileSync(join(ROOT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${MANIFEST} (${fingerprint.slice(0, 12)}).`);
