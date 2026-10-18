// Open a venue from the resting /map, then tap the sheet's close button while the
// open's work would still be running: the real-user outlier shape (a 552 ms close tap).
// usage: node twotap.mjs <base> <out.json> [gapMs]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { stubBasemap } from "./basemap.mjs";
const [base, out, gapArg] = process.argv.slice(2);
const GAP = Number(gapArg ?? 1200);
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const p = await ctx.newPage(); await stubBasemap(p);
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.enable");
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 });
await p.addInitScript(() => {
  window.__ev = []; window.__lt = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ id: e.interactionId, n: e.name, d: e.duration, t: e.startTime, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true });
});
await p.goto(base + "/map", { waitUntil: "load", timeout: 180000 });
await p.locator("canvas.maplibregl-canvas").first().waitFor({ timeout: 180000 });
await p.waitForTimeout(20000);
await p.locator(".mapArrivalCardClose").click({ timeout: 30000 }).catch(() => {});
await p.waitForTimeout(3000);
const answer = p.locator(".mapPeekAnswer:not(.isQuiet)").first();
await answer.waitFor({ timeout: 30000 });
const t0 = await p.evaluate(() => performance.now());
await answer.click({ noWaitAfter: true });
// The close control lives in the sheet header, outside the panel.
const close = p.locator(".mobileSheetPortal .surfaceNavHome").first();
await close.waitFor({ timeout: 15000 });
const tWait = await p.evaluate(() => performance.now());
const remaining = Math.max(0, GAP - (tWait - t0));
await p.waitForTimeout(remaining);
const t1 = await p.evaluate(() => performance.now());
await close.click({ noWaitAfter: true, timeout: 15000 });
await p.waitForTimeout(6000);
const { ev, lt } = await p.evaluate(() => ({ ev: window.__ev, lt: window.__lt }));
await b.close();
const byId = new Map();
for (const e of ev) { const q = byId.get(e.id); if (!q || e.d > q.d) byId.set(e.id, e); }
const inter = [...byId.values()].filter((e) => e.t >= t0 - 20).sort((a, c) => a.t - c.t);
const open = inter.find((e) => e.t < t1 - 5);
const closeEv = inter.find((e) => e.t >= t1 - 5);
const after = lt.filter((l) => l.t >= t0 && l.t < t0 + 5000);
const r = { gap: Math.round(t1 - t0), open, close: closeEv, longtaskMs: Math.round(after.reduce((s, l) => s + l.d, 0)), maxLongtask: Math.round(Math.max(0, ...after.map((l) => l.d))), firstTask: Math.round(after.find((l) => l.t >= t0 - 5)?.d ?? 0) };
writeFileSync(out, JSON.stringify(r));
console.log(`gap=${r.gap} open=${Math.round(open?.d ?? -1)} (delay ${Math.round(open?.delay ?? -1)}) close=${Math.round(closeEv?.d ?? -1)} (delay ${Math.round(closeEv?.delay ?? -1)}) longtasks5s=${r.longtaskMs} max=${r.maxLongtask} firstTask=${r.firstTask}`);
