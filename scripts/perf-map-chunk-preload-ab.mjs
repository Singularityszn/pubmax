#!/usr/bin/env node
// Interleaved A/B of a cold /map between two local production builds, one
// `next start` per arm. Measures time to the first painted, tappable pin
// (`window.__pubmaxPaintedMapTapPoints().length > 0`, the probe the CWV
// baseline uses), FCP, LCP and when the MapLibre canvas chunk was requested.
//
//   node scripts/perf-map-chunk-preload-ab.mjs \
//     --a http://127.0.0.1:3101 --b http://127.0.0.1:3102 \
//     --device mobile --pairs 5
//
// Rig rules carried from docs/proof/map-first-pin/README.md: one CDP session
// per page, HTTP cache and origin storage cleared before every sample, the arm
// not measuring parked on about:blank, and the pair order alternated so shared
// load moves both arms together. The throttle figures are VITALS_DEVICES in
// e2e/helpers/webVitals.ts.
import { chromium } from "@playwright/test";

const DEVICES = {
  mobile: {
    viewport: { width: 390, height: 844 },
    cpu: 4,
    network: { latency: 150, downloadThroughput: 188_743, uploadThroughput: 86_400 },
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    cpu: 1,
    network: { latency: 75, downloadThroughput: 1_012_500, uploadThroughput: 168_750 },
  },
};
const PIN_CEILING_MS = 45_000;
import { readFileSync } from "node:fs";

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const arms = { A: arg("a"), B: arg("b") };
const deviceName = arg("device", "mobile");
const pairs = Number(arg("pairs", "5"));
// --inject <json>: one build, both arms served through the same interception of
// the /map document; arm B's copy gains a preload link per listed chunk path
// (paths as the build's own loaders name them, "static/chunks/<file>").
const injectPath = arg("inject");
const injectFiles = injectPath ? JSON.parse(readFileSync(injectPath, "utf8")) : null;
const fetchPriority = arg("priority", "low");
const device = DEVICES[deviceName];
if (!arms.A || !arms.B || !device) {
  console.error("usage: --a <url> --b <url> [--device mobile|desktop] [--pairs 5]");
  process.exit(2);
}

const browser = await chromium.launch({
  // Set CHROMIUM_PATH when the pinned Playwright browser is not installed.
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function openArm(base, inject = false) {
  const context = await browser.newContext({ viewport: device.viewport });
  // A returning visitor as far as overlays go, the same flags the CWV probe
  // sets, so neither arm measures the first-run tour's own chunks.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    } catch {}
    const w = window;
    w.__abLcp = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__abLcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
  });
  const page = await context.newPage();
  if (injectFiles) {
    await page.route(/\/map$/, async (route) => {
      const response = await route.fetch();
      let html = await response.text();
      if (inject) {
        const dpl = /\?dpl=([\w-]+)/.exec(html)?.[1];
        const query = dpl ? `?dpl=${dpl}` : "";
        const links = injectFiles
          .map((file) => {
            const as = file.endsWith(".css") ? "style" : "script";
            return `<link rel="preload" as="${as}" fetchpriority="${fetchPriority}" href="/_next/${file}${query}"/>`;
          })
          .join("");
        html = html.replace("</head>", `${links}</head>`);
      }
      await route.fulfill({ response, body: html });
    });
  }
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  return { base, page, session };
}

async function sample(arm) {
  const { base, page, session } = arm;
  await page.goto("about:blank");
  await session.send("Network.clearBrowserCache");
  await session.send("Storage.clearDataForOrigin", {
    origin: new URL(base).origin,
    storageTypes: "all",
  });
  await session.send("Emulation.setCPUThrottlingRate", { rate: device.cpu });
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    ...device.network,
  });
  const started = Date.now();
  await page.goto(`${base}/map`, { waitUntil: "commit" });
  let firstPin = null;
  while (Date.now() - started < PIN_CEILING_MS) {
    const count = await page
      .evaluate(() => {
        const probe = window.__pubmaxPaintedMapTapPoints;
        return typeof probe === "function" ? probe().length : 0;
      })
      .catch(() => 0);
    if (count > 0) {
      firstPin = await page.evaluate(() => performance.now());
      break;
    }
    // With no basemap reachable (a sandbox whose network policy denies the
    // tile host) no pin can paint; stop once the engine and the data marks
    // are both in and have had 3 s to settle, instead of burning the ceiling.
    const settled = await page
      .evaluate(() => {
        const at = (n) => performance.getEntriesByName(n)[0]?.startTime;
        const built = at("pubmax:map-constructed");
        const data = at("pubmax:first-pins");
        return built !== undefined && data !== undefined && performance.now() > Math.max(built, data) + 3000;
      })
      .catch(() => false);
    if (settled) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const timings = await page.evaluate(() => {
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource");
    const scripts = resources.filter((r) => r.initiatorType === "script" || r.initiatorType === "link");
    // The canvas chunk is the one large script: the largest decoded JS file.
    const js = resources.filter((r) => /\/_next\/static\/.+\.js(\?|$)/.test(r.name));
    const biggest = js.sort((x, y) => y.decodedBodySize - x.decodedBodySize)[0];
    const mark = (name) => performance.getEntriesByName(name)[0]?.startTime ?? null;
    const wave1End = Math.max(
      0,
      ...js.filter((r) => r.initiatorType === "script" && r.startTime < 1500).map((r) => r.responseEnd),
    );
    const seen = new Map();
    for (const r of js) {
      const key = new URL(r.name).pathname;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const duplicates = [...seen.values()].filter((n) => n > 1).length;
    return {
      duplicates,
      fcp: paint ? Math.round(paint.startTime) : null,
      lcp: Math.round(window.__abLcp || 0) || null,
      chunkStart: biggest ? Math.round(biggest.startTime) : null,
      chunkEnd: biggest ? Math.round(biggest.responseEnd) : null,
      chunkVia: biggest?.initiatorType ?? null,
      wave1End: Math.round(wave1End),
      scriptRequests: scripts.length,
      sceneBuilt: Math.round(mark("pubmax:map-scene-built") ?? -1),
      chunkReady: Math.round(mark("pubmax:map-chunk-ready") ?? -1),
      mapConstructed: Math.round(mark("pubmax:map-constructed") ?? -1),
      firstPinsMark: Math.round(mark("pubmax:first-pins") ?? -1),
    };
  });
  // Park this arm: a page left on /map keeps rendering under the throttle.
  await page.goto("about:blank");
  return { firstPin: firstPin === null ? null : Math.round(firstPin), ...timings };
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

const open = { A: await openArm(arms.A), B: await openArm(arms.B, Boolean(injectFiles)) };
// One throwaway load per arm: the first navigation of a fresh context reports
// no paint timings (docs/rules/perf-budgets-and-measured-findings.md, rule 5).
await sample(open.A);
await sample(open.B);

const results = { A: [], B: [] };
console.log(`A/B start ${new Date().toISOString()} device=${deviceName} pairs=${pairs}`);
console.log(`A=${arms.A} B=${arms.B}`);
for (let i = 1; i <= pairs; i += 1) {
  const order = i % 2 ? ["A", "B"] : ["B", "A"];
  for (const name of order) {
    const r = await sample(open[name]);
    results[name].push(r);
    console.log(
      `pair ${i} ${name} firstPin=${r.firstPin ?? "NONE"} fcp=${r.fcp} lcp=${r.lcp} ` +
        `chunk ${r.chunkStart}->${r.chunkEnd} (${r.chunkVia}) wave1End=${r.wave1End} ` +
        `chunkReady=${r.chunkReady} constructed=${r.mapConstructed} sceneBuilt=${r.sceneBuilt} firstPinsMark=${r.firstPinsMark} dupJs=${r.duplicates}`,
    );
  }
}
console.log("");
for (const name of ["A", "B"]) {
  const rs = results[name];
  const col = (k) => rs.map((r) => r[k] ?? "NONE").join("/");
  console.log(
    `${name}: firstPin median ${median(rs.map((r) => r.firstPin))} ms (${col("firstPin")})`,
  );
  console.log(`${name}: fcp median ${median(rs.map((r) => r.fcp))} ms (${col("fcp")})`);
  console.log(`${name}: lcp median ${median(rs.map((r) => r.lcp))} ms (${col("lcp")})`);
  console.log(
    `${name}: canvas chunk requested median ${median(rs.map((r) => r.chunkStart))} ms, landed median ${median(rs.map((r) => r.chunkEnd))} ms`,
  );
  console.log(`${name}: map-chunk-ready median ${median(rs.map((r) => r.chunkReady))} ms (${col("chunkReady")})`);
  console.log(`${name}: map-constructed median ${median(rs.map((r) => r.mapConstructed))} ms (${col("mapConstructed")})`);
  console.log(`${name}: first-pins mark median ${median(rs.map((r) => r.firstPinsMark))} ms`);
}
console.log(`A/B end ${new Date().toISOString()}`);
await browser.close();
