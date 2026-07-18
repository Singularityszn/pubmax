#!/usr/bin/env node
// Generate the PUBMAXX "Crossing" static brand assets (favicon / PWA / apple)
// from the single geometry source of truth. Outputs to public/brand/ — a
// STAGING dir. This PR intentionally does NOT repoint the live manifest /
// <head> icons (see docs/BRAND_MARK.md § Activation); the owner picks the
// concept, then a one-commit activation copies these over the live files.
//
// Usage:  node scripts/gen-brand-assets.mjs
// PNGs are stamped via `sharp` when it is installed; if it is absent the script
// still writes every SVG and prints the manual export command.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "brand");

// Geometry — MUST match MARK_GEOMETRY in components/brand/PubmaxxMark.tsx.
const G = {
  stroke: 8.5,
  armA: "M18.5 18.5 L45.5 45.5",
  armB: "M45.5 18.5 L18.5 45.5",
  node: { cx: 32, cy: 32, r: 3.2 },
  plaqueRadius: 15,
};
// Tokens (literal — these files render outside the app CSS).
const C = { coral: "#ff5a5f", bright: "#ff7a55", inkDeep: "#060607", ink: "#eef3ef" };

function crossing(stroke, { withNode = true } = {}) {
  return (
    `<path d="${G.armA}" stroke="${stroke}" stroke-width="${G.stroke}" stroke-linecap="round"/>` +
    `<path d="${G.armB}" stroke="${stroke}" stroke-width="${G.stroke}" stroke-linecap="round"/>` +
    (withNode ? `<circle cx="${G.node.cx}" cy="${G.node.cy}" r="${G.node.r}" fill="${C.bright}"/>` : "")
  );
}

// Plaque: coral rounded-square, ink-deep crossing, lit node. `rx` lets the
// apple/maskable variants go full-bleed (the platform supplies the mask).
function plaque({ rx = G.plaqueRadius, scale = 1 } = {}) {
  const inner =
    scale === 1
      ? crossing(C.inkDeep)
      : `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${crossing(C.inkDeep)}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="${rx}" fill="${C.coral}"/>` +
    inner +
    `</svg>`
  );
}

// Bare favicon: transparent, currentColor-style dark ink crossing on the
// plaque. We ship the plaque favicon (reads at 16px on any browser chrome).
const SVGS = {
  "favicon.svg": plaque(),
  "icon.svg": plaque(), // scalable "any" icon
  "icon-maskable.svg": plaque({ rx: 0, scale: 0.82 }), // full-bleed, mark in safe zone
  // A monochrome outline variant for single-colour / stamped contexts.
  "mark-mono.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${crossing(
    "currentColor",
    { withNode: false },
  )}</svg>`,
};

mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(SVGS)) {
  writeFileSync(join(OUT, name), svg + "\n");
}

const PNGS = [
  { name: "icon-192.png", svg: plaque(), size: 192 },
  { name: "icon-512.png", svg: plaque(), size: 512 },
  { name: "icon-maskable-512.png", svg: plaque({ rx: 0, scale: 0.82 }), size: 512 },
  { name: "apple-touch-icon.png", svg: plaque({ rx: 0 }), size: 180 },
];

let sharp = null;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  // sharp not installed
}

if (sharp) {
  for (const { name, svg, size } of PNGS) {
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(OUT, name));
  }
  console.log(`✓ wrote ${Object.keys(SVGS).length} SVGs + ${PNGS.length} PNGs to public/brand/`);
} else {
  // Write the source SVGs so the raster step can be run later.
  for (const { name, svg } of PNGS) {
    writeFileSync(join(OUT, name.replace(/\.png$/, ".src.svg")), svg + "\n");
  }
  console.log(
    `✓ wrote ${Object.keys(SVGS).length} SVGs to public/brand/.\n` +
      `⚠ sharp not installed — PNGs skipped. Install sharp and re-run, or export the *.src.svg files at their target px.`,
  );
}
