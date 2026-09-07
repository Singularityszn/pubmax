// First tappable pin, BEFORE against AFTER, alternated on one machine.
//
// Two separate rig runs are not comparable on a laptop that is also building
// something: the machine drifts between them, and 363ms of drift reads as a
// regression. This alternates the two servers within one run, so every pair of
// samples meets the same machine.
//
//   node docs/proof/map-arrival-strip-and-turn/scripts/first-pin-paired.mjs \
//     <beforeUrl> <afterUrl> [profile] [pairs]

import { chromium } from "playwright";

const BEFORE = process.argv[2] ?? "http://127.0.0.1:31850";
const AFTER = process.argv[3] ?? "http://127.0.0.1:31849";
const PROFILE = process.argv[4] ?? "slow4g";
const PAIRS = Number(process.argv[5] ?? 5);

const browser = await chromium.launch();

async function firstPin(base) {
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
  if (PROFILE === "slow4g") {
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
  await page.goto(`${base}/map`, { waitUntil: "domcontentloaded" });
  let elapsed = null;
  for (let poll = 0; poll < 125; poll += 1) {
    const pins = await page
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
  await context.close();
  return elapsed;
}

const median = (values) => {
  const good = values.filter((value) => typeof value === "number").sort((a, b) => a - b);
  return good.length ? good[Math.floor(good.length / 2)] : null;
};

const before = [];
const after = [];
for (let pair = 0; pair < PAIRS; pair += 1) {
  before.push(await firstPin(BEFORE));
  after.push(await firstPin(AFTER));
  console.log(`${PROFILE} pair${pair + 1} before=${before[pair]} after=${after[pair]}`);
}
console.log(`${PROFILE} before ${JSON.stringify(before)} median=${median(before)}`);
console.log(`${PROFILE} after  ${JSON.stringify(after)} median=${median(after)}`);

await browser.close();
