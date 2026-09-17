#!/usr/bin/env node
// Generate the @capacitor/assets SOURCE images for the native iOS + Android
// icon / splash sets from the single PUBMAXX X brand geometry (the same source
// of truth as scripts/gen-brand-assets.mjs and components/brand/PubmaxxMark.tsx).
// The mark is the double-struck X; the native icon/splash exports carry no
// ember, matching the static web icons (the crossing is already the event).
//
// Outputs to assets/ — the default input directory @capacitor/assets reads:
//   icon-only.png        1024  full-bleed white tile + coral X (iOS icon)
//   icon-foreground.png  1024  transparent, coral X only (Android adaptive fg)
//   icon-background.png  1024  solid white (Android adaptive bg)
//   splash.png           2732  ink-deep field, coral mark (light splash)
//   splash-dark.png      2732  the SAME bytes (dark splash)
//
// It ALSO writes one file the @capacitor/assets tool knows nothing about:
//   android/app/src/main/res/drawable/ic_stat_pubmaxx.xml
// the Android status-bar notification icon. Android paints a notification icon
// from its ALPHA CHANNEL alone, so without this FCM falls back to the launcher
// icon and every push wears a white blob. A VectorDrawable covers every density
// by construction. Its manifest declaration and its accent colour are the other
// two thirds of that promise, and __tests__/androidNotificationIcon.test.ts
// holds all three to each other.
//
// It ALSO writes the legacy Android launcher PNGs straight into
// android/app/src/main/res/mipmap-*/, because @capacitor/assets stamped those
// from the adaptive FOREGROUND and shipped a coral mark on a transparent
// field: on API 24 and 25, which draw these rather than the adaptive icon and
// which this app still supports, that left the mark floating on the wallpaper
// with no tile behind it. The table is lib/brandIconAssets.mjs, the same module
// __tests__/brandIconAssets.test.ts regenerates from, so a committed launcher
// icon cannot drift off the master.
//
// Then run:  npx @capacitor/assets@3 generate
// to stamp every platform-specific size into ios/ and android/.
//
// THAT TOOL WRITES MORE THAN THE ICONS AND SPLASHES. It also rewrites
// public/manifest.webmanifest to point at an `icons/` directory of its own and
// reformats android/app/src/main/AndroidManifest.xml. Neither is wanted here:
// the web icon set is owned by scripts/gen-brand-assets.mjs and its own fence.
// Revert both, and the untracked icons/ directory, after every run. The tool is
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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import {
  BRAND_COLORS,
  MARK_VIEWBOX,
  markPolygonsSvg,
  notificationIconVectorDrawable,
} from "../lib/brandMark.mjs";
import { buildAndroidLauncherFiles } from "../lib/brandIconAssets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets");
mkdirSync(OUT, { recursive: true });

// THE SPLASH HAS ONE MASTER, AND BOTH NATIVE VARIANTS ARE CUT FROM IT.
//
// public/store-assets/splash.svg is the master gen-store-assets.mjs renders to
// public/store-assets/png/splash/splash-2732.png, and its own comment records
// the owner lock (#523): a splash is NOT an icon, it keeps the ink-deep field,
// and ONE splash serves light and dark. This script used to restate that
// treatment in its own markup and got the light variant wrong - a full-bleed
// coral field, the retired treatment - which reached every phone in light mode
// and every App Store reviewer's default device. Reading the master is what
// stops a second opinion about the splash existing at all. The icons below
// still cut their own tiles, because an icon IS a white tile and a splash is
// not.
const SPLASH_MASTER = readFileSync(join(ROOT, "public", "store-assets", "splash.svg"));

// Tokens and geometry come from lib/brandMark.mjs, the one master the in-app
// mark, the OG cards and the web icon set also read. `paper` is the Wave C
// app-icon field (owner verdict 2026-07-22): the icon set is a clean white tile
// + coral X. `inkDeep` is the dark splash field (a splash is NOT an icon and
// keeps the coral-on-ink treatment).
const C = BRAND_COLORS;

// The X group on the 64 grid, scaled about centre. `armColor` lets the dark
// splash flip the strokes to coral on an ink field. No ember on native icons.
function clink(armColor, scale = 1) {
  return (
    `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">` +
    `${markPolygonsSvg(armColor)}</g>`
  );
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MARK_VIEWBOX}">${body}</svg>`;
}

// `source` is either SVG markup this script cut, or the splash master's own
// bytes. Both are handed to sharp as a buffer.
async function png(source, size, file) {
  const svgBytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  await sharp(svgBytes).resize(size, size).png().toFile(join(OUT, file));
  process.stdout.write(`  assets/${file}\n`);
}

const jobs = [
  // iOS app icon: full-bleed WHITE square + coral X (no alpha, no rounding —
  // iOS masks). Wave C flips the field from coral to white and the mark to coral.
  ["icon-only.png", 1024, svg(`<rect width="64" height="64" fill="${C.paper}"/>${clink(C.coral, 0.82)}`)],
  // Android adaptive background: flat WHITE (the system clips it to the mask).
  ["icon-background.png", 1024, svg(`<rect width="64" height="64" fill="${C.paper}"/>`)],
  // Android adaptive foreground: coral X on transparent. The generated
  // adaptive-icon XML already insets this layer 16.7%, so the mark must fill a
  // good part of the source or it lands tiny in the launcher. The double-struck
  // X is wide (its strokes span ~75% of the 64 grid), so scale 0.8 keeps the
  // mark's ~60% span comfortably inside the 66/108 adaptive safe zone. Coral so
  // it reads on the white background layer.
  ["icon-foreground.png", 1024, svg(`${clink(C.coral, 0.8)}`)],
  // Both splashes: the master, unaltered. Same bytes for light and dark,
  // because the field IS the dark theme's deepest well and a bright launch
  // flash is exactly what a night-out app should not do.
  ["splash.png", 2732, SPLASH_MASTER],
  ["splash-dark.png", 2732, SPLASH_MASTER],
];

process.stdout.write("Generating native icon/splash source assets:\n");
for (const [file, size, markup] of jobs) {
  await png(markup, size, file);
}

// The notification icon is a FINAL artifact rather than a source: it is a
// VectorDrawable, so there is no per-density stamping for the assets tool to
// do, and it is written straight into the Android resource tree.
const NOTIFICATION_ICON = join(
  ROOT,
  "android/app/src/main/res/drawable/ic_stat_pubmaxx.xml",
);
writeFileSync(NOTIFICATION_ICON, notificationIconVectorDrawable());
process.stdout.write("  android/app/src/main/res/drawable/ic_stat_pubmaxx.xml\n");

// The legacy Android launcher set, written where Android reads it. This one is
// NOT a @capacitor/assets input: that tool is what stamped the transparent
// foreground into these slots in the first place, so the fix has to land on the
// committed files directly.
const ANDROID_RES = join(ROOT, "android/app/src/main/res");
process.stdout.write("Writing the legacy Android launcher icons:\n");
for (const [name, data] of await buildAndroidLauncherFiles()) {
  const out = join(ANDROID_RES, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data);
  process.stdout.write(`  android/app/src/main/res/${name}\n`);
}

// THE iOS LAUNCH SCREEN IS TWO ASSET-CATALOG ENTRIES, NOT A STORYBOARD.
// Info.plist names them under UILaunchScreen (UIColorName + UIImageName), the
// Info.plist launch screen Apple has offered since iOS 14. The storyboard
// route was retired because the iOS 26 runtime drew it as a plain black frame
// whatever it held (docs/proof/mobile-app-design/ios-sim-iphone17pro/launch/),
// and a launch image the system centres at its own size is also the honest
// shape for the master, whose whole subject is one mark on a dark field.
// Both entries are cut from the SAME master as every splash above, so no
// second opinion about the launch treatment exists: the colour is the field,
// the mark is the master's own centre at three iPhone scales.
const IOS_ASSETS = join(ROOT, "ios/App/App/Assets.xcassets");
const LAUNCH_MARK_POINTS = 300;
const LAUNCH_MARK_CROP = 1200;
process.stdout.write("Writing the iOS launch screen assets:\n");
{
  const dir = join(IOS_ASSETS, "LaunchMark.imageset");
  mkdirSync(dir, { recursive: true });
  // Rasterise the master ONCE at its native 2732 and cut every scale from
  // that buffer: sharp orders a crop against the input's own size, and an
  // SVG's is whatever the rasteriser picked.
  const master = await sharp(SPLASH_MASTER).resize(2732, 2732).png().toBuffer();
  const cropOrigin = (2732 - LAUNCH_MARK_CROP) / 2;
  const images = [];
  for (const scale of [1, 2, 3]) {
    const file = `LaunchMark@${scale}x.png`;
    await sharp(master)
      .extract({ left: cropOrigin, top: cropOrigin, width: LAUNCH_MARK_CROP, height: LAUNCH_MARK_CROP })
      .resize(LAUNCH_MARK_POINTS * scale, LAUNCH_MARK_POINTS * scale)
      .png()
      .toFile(join(dir, file));
    images.push({ idiom: "universal", filename: file, scale: `${scale}x` });
    process.stdout.write(`  ios/App/App/Assets.xcassets/LaunchMark.imageset/${file}\n`);
  }
  writeFileSync(
    join(dir, "Contents.json"),
    `${JSON.stringify({ images, info: { version: 1, author: "xcode" } }, null, 2)}\n`,
  );
}
{
  const dir = join(IOS_ASSETS, "LaunchBackground.colorset");
  mkdirSync(dir, { recursive: true });
  const hex = C.inkDeep.replace("#", "");
  const channel = (offset) => `0x${hex.slice(offset, offset + 2).toUpperCase()}`;
  const components = { red: channel(0), green: channel(2), blue: channel(4), alpha: "1.000" };
  // ONE colour, no dark appearance entry: the field is the same in light and
  // dark on purpose (#523), and a second entry is a second place to be wrong.
  writeFileSync(
    join(dir, "Contents.json"),
    `${JSON.stringify(
      {
        colors: [{ idiom: "universal", color: { "color-space": "srgb", components } }],
        info: { version: 1, author: "xcode" },
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write("  ios/App/App/Assets.xcassets/LaunchBackground.colorset/Contents.json\n");
}

process.stdout.write("Done. Next: npx capacitor-assets generate\n");
