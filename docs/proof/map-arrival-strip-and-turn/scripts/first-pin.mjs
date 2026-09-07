// First tappable pin on the phone, against a local production build.
//
// The walk's own rig (docs/proof/astra-live-walk/scripts/map-phone.mjs) reads
// the deployed site, so it cannot answer whether a branch made the map slower.
// This is the same measurement against a server the caller names: the same
// viewport, the same throttle profiles, and the same painted-pin probe, which
// only answers once a mark is drawn, has survived symbol collision, and carries
// no app chrome on top of it (components/map/canvas/paintedPinProbe.ts).
//
//   node docs/proof/map-arrival-strip-and-turn/scripts/first-pin.mjs <baseUrl> <label>

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:31849";
const LABEL = process.argv[3] ?? "run";
/** Three per profile: one cold read is a coin toss on a shared box. */
const RUNS = 3;

const browser = await chromium.launch();

for (const mode of ["fast", "slow4g"]) {
  const timings = [];
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      locale: "en-GB",
      timezoneId: "Europe/London",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    if (mode === "slow4g") {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 188743,
        uploadThroughput: 86400,
        connectionType: "cellular4g",
      });
    }
    const start = Date.now();
    await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
    let pins = null;
    let elapsed = null;
    for (let poll = 0; poll < 100; poll += 1) {
      pins = await page
        .evaluate(() =>
          window.__pubmaxPaintedMapTapPoints
            ? window.__pubmaxPaintedMapTapPoints()
            : null,
        )
        .catch(() => null);
      if (pins && pins.length) {
        elapsed = Date.now() - start;
        break;
      }
      await page.waitForTimeout(200);
    }
    timings.push(elapsed);
    console.log(
      `${LABEL} ${mode} run${run + 1} firstTappablePin_ms=${elapsed} pins=${pins ? pins.length : 0}`,
    );
    await context.close();
  }
  const good = timings.filter((value) => typeof value === "number");
  const median = good.sort((a, b) => a - b)[Math.floor(good.length / 2)];
  console.log(`${LABEL} ${mode} MEDIAN firstTappablePin_ms=${median}`);
}

await browser.close();
