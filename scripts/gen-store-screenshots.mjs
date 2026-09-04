// Store screenshots, rendered from the real screens.
//
//   npm run gen:store-screenshots            (against a running production server)
//   BASE=http://localhost:3000 npm run gen:store-screenshots
//
// THREE rules, and the first is the point of the script.
//
// 1. EVERY SHOT IS RENDERED AT ITS TARGET SIZE, never upscaled. Each store size
//    below is a real device viewport at deviceScaleFactor 3, so the pixels come
//    out exactly right: 430x932 is the 6.7" iPhone, 414x896 the 6.5", 360x640 a
//    common Android. Upscaling a 430-wide frame to 1290 is what makes a listing
//    look like a website somebody photographed.
// 2. IT MUST BE A PRODUCTION SERVER. `next dev` paints its own overlay badge in
//    the bottom-left corner, which lands squarely on the phone tab bar, and a
//    dev badge in a store screenshot is the kind of thing review notices and
//    drinkers laugh at. The script refuses a server that is serving dev.
// 3. NOTHING IS STAGED. The shots are the app on the routes a first-time
//    visitor lands on. No seeded prices, no fake handles, no invented pubs: a
//    listing screenshot is a claim about what the app does, and the price lanes
//    in this codebase are built on not making claims we cannot keep.
//
// The captions travel with the shots in each size's manifest.json rather than
// being burnt into the image, because both stores take them as their own field
// and a baked caption cannot be localised or corrected without a re-render.
//
// Every shot is re-encoded through sharp before it lands. Playwright writes an
// unoptimised PNG, and the map screenshot alone is 1.8 MB of that: eighteen of
// them would put twelve megabytes into every clone of this repo for ever. The
// re-encode keeps PNG, which both stores prefer and neither compresses further,
// and changes no pixel.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "store-assets", "screenshots");
const BASE = process.env.BASE ?? "http://localhost:3000";

/**
 * What each store actually requires.
 *
 * Apple takes one 6.7" set to cover both iPhone sizes, but the 6.5" set is
 * cheap to render and removes a manual resize from the owner's upload, so both
 * ship. Google Play wants 9:16 phone shots between 320 and 3840 px.
 */
const SIZES = [
  { key: "ios-6.7", viewport: { width: 430, height: 932 }, scale: 3, note: "Apple 6.7 inch, 1290x2796" },
  { key: "ios-6.5", viewport: { width: 414, height: 896 }, scale: 3, note: "Apple 6.5 inch, 1242x2688" },
  { key: "play-phone", viewport: { width: 360, height: 640 }, scale: 3, note: "Google Play phone, 1080x1920" },
];

/**
 * The shot list from docs/STORE_READINESS.md section 6, in listing order. The
 * first three carry the listing, because most installs are decided on those.
 */
const SHOTS = [
  { slug: "map", route: "/map", caption: "London pubs on the map." },
  // A borough rather than /near: the caption promises prices, and /near before
  // the location grant is a button and a list of areas with no figure on it.
  { slug: "prices", route: "/borough/hackney", caption: "What a pint actually costs." },
  { slug: "crawl", route: "/crawls", caption: "A crawl you can actually walk." },
  { slug: "tonight", route: "/tonight", caption: "What is on across London tonight." },
  { slug: "index", route: "/pint-index", caption: "Pint prices, month by month." },
  { slug: "plan", route: "/plan", caption: "Describe the night. Get it in order." },
];

/**
 * The analytics disclosure is honest in the app and noise in a listing, so it
 * is ANSWERED before the page loads rather than hidden after the fact. The key
 * is imported from nowhere on purpose: this is a plain node CLI and
 * lib/analyticsIdentity.ts is TypeScript, so the value is restated and the
 * assertion below is what keeps the two together. A wrong key fails the run.
 *
 * The answer is `denied`, which hides the card exactly as `granted` does. A
 * screenshot run against production would otherwise put eighteen robot page
 * views into the real numbers, and this is the one lane where a browser here
 * can write to a live product metric.
 */
const ANALYTICS_CONSENT_STORAGE_KEY = "pubmaxx:analytics-consent:v1";
const CONSENT_SELECTOR = ".analyticsConsentPrompt";

/**
 * The map's first-visit location card is the same case and gets the same
 * treatment. It is the right card in the app and it is the wrong thing in the
 * listing's lead shot: it covers the bottom third of the frame, so the one
 * screenshot most installs are decided on shows a permission ask rather than
 * London full of pubs. Answering it before the page loads leaves the map a
 * returning visitor's map, which is what the caption claims.
 * Key restated for the same reason as the consent key above: this is a plain
 * node CLI and lib/mapFirstVisitArrival.ts is TypeScript. The assertion in the
 * shot loop is what keeps the two together.
 */
const MAP_FIRST_VISIT_ARRIVAL_KEY = "pubmax:map-first-visit-arrival:v1";
const MAP_ARRIVAL_SELECTOR = ".mapArrivalCard";

async function assertProductionServer(page) {
  const servingDev = await page.evaluate(
    () =>
      [...document.querySelectorAll("script[src]")].some((script) =>
        (script.getAttribute("src") ?? "").includes("webpack-hmr"),
      ) || Boolean(document.querySelector("nextjs-portal")),
  );
  if (servingDev) {
    throw new Error(
      "Refusing to shoot a dev server: its overlay badge paints on the tab bar. " +
        "Build and serve first, e.g. NEXT_DIST_DIR=.next-prod npm run build && NEXT_DIST_DIR=.next-prod npm start",
    );
  }
}

const browser = await chromium.launch();
let shotCount = 0;

try {
  for (const size of SIZES) {
    const dir = join(OUT, size.key);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    const context = await browser.newContext({
      viewport: size.viewport,
      deviceScaleFactor: size.scale,
      isMobile: true,
      hasTouch: true,
      colorScheme: "light",
      locale: "en-GB",
      timezoneId: "Europe/London",
      // Reduced motion so an entrance animation cannot be caught half-played.
      reducedMotion: "reduce",
    });
    await context.addInitScript((keys) => {
      try {
        window.localStorage.setItem(keys.consent, "denied");
        window.localStorage.setItem(keys.mapArrival, "dismissed");
      } catch {
        // Private mode in a throwaway context. The assertions below catch it.
      }
    }, {
      consent: ANALYTICS_CONSENT_STORAGE_KEY,
      mapArrival: MAP_FIRST_VISIT_ARRIVAL_KEY,
    });

    const page = await context.newPage();
    const manifest = [];

    for (const [index, shot] of SHOTS.entries()) {
      await page.goto(`${BASE}${shot.route}`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      });
      if (index === 0) await assertProductionServer(page);
      // The map paints through a canvas, so a settled network is not a settled
      // frame. One extra beat is cheaper than a half-drawn tile in a listing.
      await page.waitForTimeout(3_000);
      // Loudly, not quietly: a consent card is exactly the kind of thing that
      // ships in a listing because a storage key was renamed and the hide
      // silently matched nothing.
      if (await page.locator(CONSENT_SELECTOR).count()) {
        throw new Error(
          `The analytics disclosure is still on ${shot.route}. ` +
            `ANALYTICS_CONSENT_STORAGE_KEY here (${ANALYTICS_CONSENT_STORAGE_KEY}) no longer ` +
            "matches lib/analyticsIdentity.ts.",
        );
      }
      if (await page.locator(MAP_ARRIVAL_SELECTOR).count()) {
        throw new Error(
          `The first-visit location card is still on ${shot.route}. ` +
            `MAP_FIRST_VISIT_ARRIVAL_KEY here (${MAP_FIRST_VISIT_ARRIVAL_KEY}) no longer ` +
            "matches lib/mapFirstVisitArrival.ts.",
        );
      }

      const file = `${String(index + 1).padStart(2, "0")}-${shot.slug}.png`;
      // Lossless: sharp re-deflates the same pixels at a compression level
      // Playwright does not spend the time on.
      await sharp(await page.screenshot())
        .png({ compressionLevel: 9, effort: 10 })
        .toFile(join(dir, file));
      manifest.push({ file, route: shot.route, caption: shot.caption });
      shotCount += 1;
      console.log(`${size.key}/${file}`);
    }

    writeFileSync(
      join(dir, "manifest.json"),
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: size.note,
          width: size.viewport.width * size.scale,
          height: size.viewport.height * size.scale,
          shots: manifest,
        },
        null,
        2,
      )}\n`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${shotCount} screenshots across ${SIZES.length} store sizes in ${OUT}`);
