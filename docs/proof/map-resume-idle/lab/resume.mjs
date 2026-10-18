// Open a venue from the resting /map, then pan the map four times. Ledger every
// map-resume write: rows JSON.stringify, localStorage.setItem and IndexedDB put,
// each timed on the main thread, plus long tasks and Event Timing.
// usage: node resume.mjs <base> <out.json>
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { stubBasemap } from "./basemap.mjs";
const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const p = await ctx.newPage(); await stubBasemap(p);
const cdp = await ctx.newCDPSession(p);
await cdp.send("Network.enable");
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 });
await p.addInitScript(() => {
  const w = window; w.__w = []; w.__lt = []; w.__ev = [];
  const big = 20_000;
  const str = JSON.stringify;
  JSON.stringify = function (...a) { const t = performance.now(); const r = str.apply(this, a); const d = performance.now() - t; if (typeof r === "string" && r.length > big) w.__w.push({ k: "stringify", t, d, n: r.length }); return r; };
  const si = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { const t = performance.now(); const r = si.call(this, k, v); if (String(k).startsWith("map-resume")) w.__w.push({ k: "setItem", t, d: performance.now() - t, n: String(v).length }); return r; };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (row, ...rest) { const t = performance.now(); const r = put.call(this, row, ...rest); if (String(row?.key).startsWith("map-resume")) w.__w.push({ k: "put", t, d: performance.now() - t }); return r; };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) w.__ev.push({ id: e.interactionId, d: e.duration, t: e.startTime }); }).observe({ type: "event", buffered: true, durationThreshold: 16 });
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
await p.waitForTimeout(8000);
await p.locator(".mobileSheetPortal .surfaceNavHome").first().click({ timeout: 15000 }).catch(() => {});
await p.waitForTimeout(3000);
const tPan = await p.evaluate(() => performance.now());
for (let i = 0; i < 4; i++) {
  const dx = i % 2 ? -120 : 120;
  await p.mouse.move(195, 300); await p.mouse.down();
  for (let s = 1; s <= 6; s++) await p.mouse.move(195 + (dx * s) / 6, 300 + (s * 10));
  await p.mouse.up();
  await p.waitForTimeout(2500);
}
await p.waitForTimeout(3000);
const { w, lt } = await p.evaluate(() => ({ w: window.__w, lt: window.__lt }));
await b.close();
const after = w.filter((x) => x.t >= t0);
const sum = (k, from, to = Infinity) => after.filter((x) => x.k === k && x.t >= from && x.t < to);
const phase = (from, to) => {
  const s = sum("setItem", from, to), j = sum("stringify", from, to), u = sum("put", from, to);
  const ms = [...s, ...j, ...u].reduce((a, x) => a + x.d, 0);
  return { writes: s.length, stringify: j.length, ms: Math.round(ms), maxBytes: Math.max(0, ...s.map((x) => x.n)) };
};
const by = (k) => Math.round(after.filter((x) => x.k === k).reduce((a, x) => a + x.d, 0));
const r = { open: phase(t0, tPan), pan: phase(tPan), split: { stringify: by("stringify"), setItem: by("setItem"), put: by("put") }, longtaskOpen: Math.round(lt.filter((l) => l.t >= t0 && l.t < tPan).reduce((a, l) => a + l.d, 0)), longtaskPan: Math.round(lt.filter((l) => l.t >= tPan).reduce((a, l) => a + l.d, 0)) };
writeFileSync(out, JSON.stringify(r));
console.log(JSON.stringify(r));
