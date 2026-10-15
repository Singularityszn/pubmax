#!/usr/bin/env node
// Interleaved A/B of a cold /map between two local production builds, one
// `next start` per arm. Measures time to the first painted, tappable pin
// (`window.__pubmaxPaintedMapTapPoints().length > 0`, the probe the CWV
// baseline uses), FCP, LCP and when the MapLibre canvas chunk was requested.
//
//   node scripts/perf/ab-map-chunk-preload.mjs \
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

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at > -1 ? process.argv[at + 1] : fallback;
}

const arms = { A: arg("a"), B: arg("b") };
const deviceName = arg("device", "mobile");
const pairs = Number(arg("pairs", "5"));
const device = DEVICES[deviceName];
if (!arms.A || !arms.B || !device) {
  console.error("usage: --a <url> --b <url> [--device mobile|desktop] [--pairs 5]");
  process.exit(2);
}

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function openArm(base) {
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
    return {
      fcp: paint ? Math.round(paint.startTime) : null,
      lcp: Math.round(window.__abLcp || 0) || null,
      chunkStart: biggest ? Math.round(biggest.startTime) : null,
      chunkEnd: biggest ? Math.round(biggest.responseEnd) : null,
      chunkVia: biggest?.initiatorType ?? null,
      wave1End: Math.round(wave1End),
      scriptRequests: scripts.length,
      sceneBuilt: Math.round(mark("pubmax:map-scene-built") ?? -1),
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

const open = { A: await openArm(arms.A), B: await openArm(arms.B) };
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
        `sceneBuilt=${r.sceneBuilt} firstPinsMark=${r.firstPinsMark}`,
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
  console.log(`${name}: first-pins mark median ${median(rs.map((r) => r.firstPinsMark))} ms`);
}
console.log(`A/B end ${new Date().toISOString()}`);
await browser.close();
