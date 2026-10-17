// When does the sheet (its close control) and the panel first paint after the open tap?
import { chromium } from "playwright";
import { stubBasemap } from "./basemap.mjs";
const [base] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const p = await ctx.newPage(); await stubBasemap(p);
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.enable");
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 });
await p.goto(base + "/map", { waitUntil: "load", timeout: 180000 });
await p.locator("canvas.maplibregl-canvas").first().waitFor({ timeout: 180000 });
await p.waitForTimeout(20000);
await p.locator(".mapArrivalCardClose").click({ timeout: 30000 }).catch(() => {});
await p.waitForTimeout(3000);
const answer = p.locator(".mapPeekAnswer:not(.isQuiet)").first();
await answer.waitFor({ timeout: 30000 });
await p.evaluate(() => {
  const w = window; w.__marks = {}; const t0 = performance.now(); w.__t0 = t0;
  const vis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight; };
  const tick = () => {
    const now = performance.now() - t0;
    if (w.__marks.sheet === undefined && vis(".mobileSheetPortal .surfaceNavHome")) w.__marks.sheet = now;
    if (w.__marks.skeleton === undefined && vis(".mobileSheetPortal .venueSheetSkeleton")) w.__marks.skeleton = now;
    if (w.__marks.panel === undefined && vis(".mobileSheetPortal .venueInspector")) w.__marks.panel = now;
    if (now < 8000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await answer.click({ noWaitAfter: true });
await p.waitForTimeout(9000);
const m = await p.evaluate(() => window.__marks);
console.log(JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.round(v)]))));
await b.close();
