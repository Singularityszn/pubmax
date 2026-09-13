// Cold decoded bytes on the audit's phone rig, per route, for lane 1.13.
// Method mirrors docs/proof/map-bytes-first-pin/: 390x844, DPR 1, 4x CPU,
// Slow 4G (135 ms, 188743 B/s down, 86400 B/s up), a fresh context per sample,
// 25 s settle after load, decoded response bodies totalled over every request.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const port = process.argv[2];
const out = process.argv[3];
const base = `http://127.0.0.1:${port}`;
const SETTLE_MS = 25_000;

const ROUTES = [
  { id: "/map", path: "/map", drinks: false },
  { id: "/map?sel=venue-1vle947", path: "/map?sel=venue-1vle947", drinks: false },
  { id: "/map?sel=venue-1vle947 + Drinks tab", path: "/map?sel=venue-1vle947", drinks: true },
];

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-lcd-text",
    "--hide-scrollbars",
  ],
});

const results = [];
for (const route of ROUTES) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 135,
    downloadThroughput: 188743,
    uploadThroughput: 86400,
  });

  let bytes = 0;
  let requests = 0;
  const perUrl = new Map();
  const pending = [];
  page.on("response", (response) => {
    requests += 1;
    pending.push(
      response
        .body()
        .then((body) => {
          bytes += body.length;
          const url = new URL(response.url()).pathname;
          perUrl.set(url, (perUrl.get(url) ?? 0) + body.length);
        })
        .catch(() => {}),
    );
  });

  await page.goto(base + route.path, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  let drinksOpened = false;
  if (route.drinks) {
    const tab = page.getByRole("tab", { name: "Drinks", exact: true });
    try {
      await tab.click({ timeout: 20_000 });
      drinksOpened = true;
    } catch {
      drinksOpened = false;
    }
    await page.waitForTimeout(SETTLE_MS);
  }
  await Promise.all(pending);

  const packs = {};
  for (const [url, size] of perUrl) {
    if (
      url.includes("price_updates") ||
      url.includes("wetherspoons") ||
      url.startsWith("/api/venue/") ||
      url.includes("maplibre-gl-")
    ) {
      packs[url] = size;
    }
  }
  results.push({
    route: route.id,
    drinksOpened,
    decodedKb: Math.round(bytes / 1024),
    requests,
    watched: packs,
  });
  console.log(
    `${route.id}: ${Math.round(bytes / 1024)} KB over ${requests} requests` +
      (route.drinks ? ` (Drinks tab opened: ${drinksOpened})` : ""),
  );
  await context.close();
}

await browser.close();
writeFileSync(out, JSON.stringify(results, null, 2));
