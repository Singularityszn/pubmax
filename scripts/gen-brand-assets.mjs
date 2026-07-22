#!/usr/bin/env node
// Generate the PUBMAXX X web brand assets (favicon / PWA / apple) from the
// single geometry source of truth. The mark is the double-struck X (one thick
// descending stroke + two thin ascending strokes), owner-approved 2026-07-22.
// This script stamps the LIVE files under public/ directly and also refreshes
// the public/brand/ reference mirror docs/BRAND_MARK.md points at.
//
// The static icon exports carry NO ember: the double-struck crossing is already
// the event, and a dot muddies the silhouette at icon sizes. The 16px favicon.ico
// entry uses the simplified single-slash variant (`slashSimple`) because the
// double-stroke channel closes up below ~24px.
//
// Usage:  node scripts/gen-brand-assets.mjs
// PNGs + the favicon.ico container are stamped via `sharp` (already a
// dependency). If sharp cannot load the script fails loudly — do NOT add a new
// raster dependency; export the emitted SVGs by hand instead.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const BRAND = join(PUBLIC, "brand");

// Geometry — MUST match MARK_GEOMETRY in components/brand/PubmaxxMark.tsx and
// the copy in scripts/gen-native-app-icons.mjs. THE DOUBLE-STRUCK X: one thick
// descending stroke (\) drawn on top of two thin parallel ascending strokes (/).
const G = {
  thick: "9,10 21,10 55,54 43,54",
  thinA: "42,10 47,10 13,54 8,54",
  thinB: "51,10 56,10 22,54 17,54",
  slashSimple: "45,10 53,10 19,54 11,54",
  node: { cx: 32, cy: 32, r: 3.2 },
  plaqueRadius: 15,
};
// Tokens (literal — these files render outside the app CSS).
const C = { coral: "#ff5a5f", bright: "#ff7a55", inkDeep: "#060607" };

// The X mark: two thin ascending strokes then the thick descending stroke on
// top. `simple:true` is the small-optics cut (16px raster tier): the double
// stroke closes up, so a single clean ascending slash carries the mark. The
// static icon exports never carry the ember (`node` is app-surface only).
function mark(fill, { simple = false } = {}) {
  const ascending = simple
    ? `<polygon points="${G.slashSimple}" fill="${fill}"/>`
    : `<polygon points="${G.thinA}" fill="${fill}"/><polygon points="${G.thinB}" fill="${fill}"/>`;
  return ascending + `<polygon points="${G.thick}" fill="${fill}"/>`;
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
}

// Bare X on transparent — favicon / PWA "any" icons; coral strokes, no ember.
function bareSvg({ simple = false, fill = C.coral } = {}) {
  return svg(mark(fill, { simple }));
}

// X on a full-bleed ink-deep tile. `rx` lets the maskable variant go square
// (rx 0, the platform supplies the mask); `scale` insets the mark into the
// maskable safe zone. Strokes are coral, field ink-deep, no ember.
function tileSvg({ rx = G.plaqueRadius, scale = 1 } = {}) {
  const m =
    scale === 1
      ? mark(C.coral)
      : `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${mark(C.coral)}</g>`;
  return svg(`<rect width="64" height="64" rx="${rx}" fill="${C.inkDeep}"/>${m}`);
}

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch (err) {
  process.stderr.write(
    "gen-brand-assets: the raster step needs the `sharp` package and it failed to load.\n" +
      `  (${err instanceof Error ? err.message : String(err)})\n` +
      "  Do not add a raster dependency; export the emitted SVGs by hand at their target px.\n",
  );
  process.exit(1);
}

async function pngBuffer(markup, size, { opaque = false } = {}) {
  let img = sharp(Buffer.from(markup)).resize(size, size);
  if (opaque) img = img.flatten({ background: C.inkDeep });
  return img.png().toBuffer();
}

// Build a classic multi-image ICO (PNG members): 6-byte ICONDIR + one 16-byte
// ICONDIRENTRY per size + the PNG blobs. The 16px entry uses the simplified
// single-slash small-optics cut. The repo has no ico tool, so we assemble the
// container.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  entries.forEach((e, i) => {
    const b = dir.subarray(i * 16, i * 16 + 16);
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 0); // width (0 => 256)
    b.writeUInt8(e.size >= 256 ? 0 : e.size, 1); // height
    b.writeUInt8(0, 2); // palette
    b.writeUInt8(0, 3); // reserved
    b.writeUInt16LE(1, 4); // colour planes
    b.writeUInt16LE(32, 6); // bits per pixel
    b.writeUInt32LE(e.png.length, 8); // bytes in resource
    b.writeUInt32LE(offset, 12); // offset from start of file
    offset += e.png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

mkdirSync(BRAND, { recursive: true });

// ── SVGs ──────────────────────────────────────────────────────────────────────
const bare = bareSvg() + "\n";
const maskable = tileSvg({ rx: 0, scale: 0.82 }) + "\n";
const monoMark = svg(`<g fill="currentColor">${mark("currentColor")}</g>`) + "\n";
const sized = (px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">${mark(C.coral)}</svg>\n`;

// Live public/ files (the icons app/layout.tsx references).
writeFileSync(join(PUBLIC, "favicon.svg"), bare);
writeFileSync(join(PUBLIC, "icon-192.svg"), sized(192));
writeFileSync(join(PUBLIC, "icon-512.svg"), sized(512));
writeFileSync(join(PUBLIC, "icon-maskable.svg"), maskable);

// public/brand/ reference mirror (docs/BRAND_MARK.md points here).
writeFileSync(join(BRAND, "favicon.svg"), bare);
writeFileSync(join(BRAND, "icon.svg"), bare);
writeFileSync(join(BRAND, "icon-maskable.svg"), maskable);
writeFileSync(join(BRAND, "mark-mono.svg"), monoMark);

// ── PNGs ──────────────────────────────────────────────────────────────────────
const icon192 = await pngBuffer(bareSvg(), 192);
const icon512 = await pngBuffer(bareSvg(), 512);
const maskable512 = await pngBuffer(tileSvg({ rx: 0, scale: 0.82 }), 512, { opaque: true });
const appleTouch = await pngBuffer(tileSvg({ rx: 0, scale: 0.9 }), 180, { opaque: true });

writeFileSync(join(PUBLIC, "icon-192.png"), icon192);
writeFileSync(join(PUBLIC, "icon-512.png"), icon512);
writeFileSync(join(PUBLIC, "icon-maskable-512.png"), maskable512);
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), appleTouch);
writeFileSync(join(BRAND, "icon-192.png"), icon192);
writeFileSync(join(BRAND, "icon-512.png"), icon512);
writeFileSync(join(BRAND, "icon-maskable-512.png"), maskable512);
writeFileSync(join(BRAND, "apple-touch-icon.png"), appleTouch);

// ── favicon.ico (16 no-node / 32 / 48) ────────────────────────────────────────
const ico = buildIco([
  { size: 16, png: await pngBuffer(bareSvg({ simple: true }), 16) },
  { size: 32, png: await pngBuffer(bareSvg(), 32) },
  { size: 48, png: await pngBuffer(bareSvg(), 48) },
]);
writeFileSync(join(PUBLIC, "favicon.ico"), ico);

console.log(
  "✓ PUBMAXX X web assets stamped:\n" +
    "  public/: favicon.svg, favicon.ico, icon-192.svg/.png, icon-512.svg/.png,\n" +
    "           icon-maskable.svg, icon-maskable-512.png, apple-touch-icon.png\n" +
    "  public/brand/: favicon.svg, icon.svg, icon-maskable.svg, mark-mono.svg + PNGs",
);
