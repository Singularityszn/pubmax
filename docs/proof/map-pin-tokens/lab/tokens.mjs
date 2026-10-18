// Open a pub from the resting /map, then pan the map four times. Count every
// full theme-token read (readTokens adds one hidden probe span to <html>) and
// time the computed-style reads it makes: custom properties (--*) and the
// probe's resolved colour, where the browser pays the forced style recalc.
// usage: node tokens.mjs <base> <out.json>
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
  const w = window; w.__r = []; w.__lt = [];
  const gpv = CSSStyleDeclaration.prototype.getPropertyValue;
  CSSStyleDeclaration.prototype.getPropertyValue = function (name) {
    if (typeof name !== "string" || !name.startsWith("--")) return gpv.call(this, name);
    const t = performance.now(); const r = gpv.call(this, name);
    w.__r.push({ k: "var", t, d: performance.now() - t }); return r;
  };
  const computed = window.getComputedStyle;
  window.getComputedStyle = function (el, ...rest) {
    const style = computed.call(this, el, ...rest);
    if (!(el?.tagName === "SPAN" && el.hidden)) return style;
    return new Proxy(style, { get(target, key) {
      if (key !== "color") { const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v; }
      const t = performance.now(); const r = target.color;
      w.__r.push({ k: "colour", t, d: performance.now() - t }); return r;
    } });
  };
  const append = Node.prototype.appendChild;
  Node.prototype.appendChild = function (child) {
    if (this === document.documentElement && child?.tagName === "SPAN" && child.hidden) w.__r.push({ k: "probe", t: performance.now(), d: 0 });
    return append.call(this, child);
  };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push({ t: e.startTime, d: e.duration }); }).observe({ type: "longtask", buffered: true });
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
const { r, lt } = await p.evaluate(() => ({ r: window.__r, lt: window.__lt }));
await b.close();
const phase = (from, to = Infinity) => {
  const inside = r.filter((x) => x.t >= from && x.t < to);
  const ms = (k) => Math.round(inside.filter((x) => x.k === k).reduce((a, x) => a + x.d, 0));
  return { tokenReads: inside.filter((x) => x.k === "probe").length, varMs: ms("var"), colourMs: ms("colour"),
    longtaskMs: Math.round(lt.filter((l) => l.t >= from && l.t < to).reduce((a, l) => a + l.d, 0)) };
};
const res = { load: phase(0, t0), open: phase(t0, tPan), pan: phase(tPan) };
writeFileSync(out, JSON.stringify(res));
console.log(JSON.stringify(res));
