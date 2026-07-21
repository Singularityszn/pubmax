#!/usr/bin/env node
// Generate the @capacitor/assets SOURCE images for the native iOS + Android
// icon / splash sets from the single "Clink" brand geometry (the same source of
// truth as scripts/gen-brand-assets.mjs and components/brand/PubmaxxMark.tsx).
//
// Outputs to assets/ — the default input directory @capacitor/assets reads:
//   icon-only.png        1024  full-bleed coral tile + ink Clink (iOS icon)
//   icon-foreground.png  1024  transparent, Clink only (Android adaptive fg)
//   icon-background.png  1024  solid coral (Android adaptive bg)
//   splash.png           2732  coral field, centred ink mark (light splash)
//   splash-dark.png      2732  ink-deep field, coral mark (dark splash)
//
// Then run:  npx @capacitor/assets@3 generate
// to stamp every platform-specific size into ios/ and android/. The tool is
// intentionally NOT a pinned devDependency — its transitive tree carries high
// npm-audit advisories that would fail `npm run ci`, and the generated output
// is committed anyway, so it is fetched ephemerally via npx only when the mark
// changes. (If the nested sharp binary fails to load under a blocked-install
// sandbox, `rm -rf node_modules/@capacitor/assets/node_modules/sharp` once so
// it resolves the hoisted sharp. When npx cannot fetch the tool at all, the
// committed ios/ + android/ PNGs can be re-stamped from these sources directly
// with the hoisted sharp — see the activation notes in docs/BRAND_MARK.md.)
//
// Usage:  node scripts/gen-native-app-icons.mjs

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

// Tokens — literal (these render outside the app CSS). MUST match
// scripts/gen-brand-assets.mjs and components/brand/PubmaxxMark.tsx.
const C = { coral: "#ff5a5f", bright: "#ff7a55", inkDeep: "#060607" };

// THE CLINK on the canonical 64-unit grid: two tapered pint arms (wide mouths
// up, narrow bases down) meeting at an ember node.
const G = {
  armA: "19.8,8.7 10.2,17.3 46.0,53.7 52.0,48.3",
  armB: "44.2,8.7 53.8,17.3 18.0,53.7 12.0,48.3",
  node: { cx: 32, cy: 32, r: 3.2 },
};

// The Clink group on a 64 grid, scaled about centre. `armColor` lets the dark
// splash flip the arms to coral on an ink field; the ember stays bright.
function clink(armColor, scale = 1) {
  const inner =
    `<polygon points="${G.armA}" fill="${armColor}"/>` +
    `<polygon points="${G.armB}" fill="${armColor}"/>` +
    `<circle cx="${G.node.cx}" cy="${G.node.cy}" r="${G.node.r}" fill="${C.bright}"/>`;
  return `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${inner}</g>`;
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;
}

async function png(markup, size, file) {
  await sharp(Buffer.from(markup)).resize(size, size).png().toFile(join(OUT, file));
  process.stdout.write(`  assets/${file}\n`);
}

const jobs = [
  // iOS app icon: full-bleed coral square (no alpha, no rounding — iOS masks).
  ["icon-only.png", 1024, svg(`<rect width="64" height="64" fill="${C.coral}"/>${clink(C.inkDeep, 0.82)}`)],
  // Android adaptive background: flat coral (the system clips it to the mask).
  ["icon-background.png", 1024, svg(`<rect width="64" height="64" fill="${C.coral}"/>`)],
  // Android adaptive foreground: Clink on transparent, near full-bleed
  // (scale 1.0). The generated adaptive-icon XML already insets this layer
  // 16.7%, so the mark must fill the source or it lands tiny in the launcher;
  // at 1.0 the arms span ~56% of the canvas — comfortably inside the safe zone.
  ["icon-foreground.png", 1024, svg(`${clink(C.inkDeep, 1.0)}`)],
  // Light splash: centred mark on the coral field, small (scale 0.28).
  ["splash.png", 2732, svg(`<rect width="64" height="64" fill="${C.coral}"/>${clink(C.inkDeep, 0.28)}`)],
  // Dark splash: coral mark on the ink-deep field.
  ["splash-dark.png", 2732, svg(`<rect width="64" height="64" fill="${C.inkDeep}"/>${clink(C.coral, 0.28)}`)],
];

process.stdout.write("Generating native icon/splash source assets:\n");
for (const [file, size, markup] of jobs) {
  await png(markup, size, file);
}
process.stdout.write("Done. Next: npx capacitor-assets generate\n");
