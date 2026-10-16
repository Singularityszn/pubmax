// Lab: Slow 4G + 4x CPU, 390x844 phone, production build.
// Records every layout shift with its sources, CLS (session-window, as web-vitals),
// long tasks, and per-interaction Event Timing durations.
// usage: node vitals-lab.mjs <baseUrl> <outJson> [runs] [routesCsv]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { stubBasemap } from "./basemap.mjs";

const [base, out, runsArg, routesArg] = process.argv.slice(2);
const RUNS = Number(runsArg ?? 3);

const ROUTES = (routesArg ?? "/map,/,/u/you,/tonight,/plan,/out,/places,/pal").split(",");

const PROBE = () => {
  const w = window;
  w.__lab = { shifts: [], longtasks: [], events: [] };
  const describe = (n) => {
    if (!n || !n.nodeType) return null;
    const el = n.nodeType === 1 ? n : n.parentElement;
    if (!el) return "#text";
    const parts = [];
    let e = el;
    for (let i = 0; e && i < 4; i++, e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) s += "#" + e.id;
      const cls = (typeof e.className === "string" ? e.className : "").trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) s += "." + cls.join(".");
      parts.unshift(s);
    }
    return parts.join(">");
  };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      w.__lab.shifts.push({
        t: Math.round(e.startTime), v: e.value, input: e.hadRecentInput,
        src: (e.sources || []).map((s) => ({
          node: describe(s.node),
          prev: [s.previousRect.y, s.previousRect.height].map(Math.round),
          cur: [s.currentRect.y, s.currentRect.height].map(Math.round),
        })),
      });
    }
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__lab.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
  }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (!e.interactionId) continue;
      w.__lab.events.push({ id: e.interactionId, name: e.name, d: e.duration, t: Math.round(e.startTime), target: describe(e.target),
        inDelay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart) });
    }
  }).observe({ type: "event", buffered: true, durationThreshold: 16 });
};

function sessionCls(shifts) {
  let max = 0, cur = 0, first = -1, last = -1;
  for (const s of shifts) {
    if (s.input) continue;
    if (first >= 0 && s.t - last < 1000 && s.t - first < 5000) { cur += s.v; }
    else { cur = s.v; first = s.t; }
    last = s.t;
    max = Math.max(max, cur);
  }
  return max;
}

async function tryClick(page, sel, label, acts) {
  const loc = page.locator(sel).first();
  try {
    await loc.waitFor({ state: "visible", timeout: 8000 });
    await loc.click({ timeout: 5000, noWaitAfter: true });
    acts.push(label);
    await page.waitForTimeout(2500);
  } catch { acts.push(label + " (missing)"); }
}

// Interactions per route: the main taps a person makes. Navigation is suppressed
// so the measured frame is the handler + render, not a page change.
const INTERACT = {
  "/map": async (page, acts) => {
    await page.mouse.click(195, 420); acts.push("canvas tap"); await page.waitForTimeout(3000);
    await tryClick(page, ".mapVenueKindFilter button, [data-venue-kind-filter] button", "venue kind filter", acts);
    await page.keyboard.press("Escape").catch(() => {});
    await tryClick(page, ".mapCompassBtn, .mapFitLondonBtn", "compass/fit", acts);
    await tryClick(page, "button:has-text('Layers'), .mapLayersBtn", "layers", acts);
  },
  "/": async (page, acts) => { await tryClick(page, "[data-primary-action] a, [data-primary-action] button", "primary", acts); },
  "/tonight": async (page, acts) => {
    await tryClick(page, "main button >> nth=0", "first button", acts);
    await tryClick(page, "[data-primary-action] a, [data-primary-action] button", "primary", acts);
  },
  "/plan": async (page, acts) => {
    const q = page.locator("#plan-describe-first-query");
    try { await q.waitFor({ timeout: 10000 }); await q.click(); await q.pressSequentially("quiet in Clapham", { delay: 60 }); acts.push("type"); await page.waitForTimeout(1500); } catch { acts.push("type (missing)"); }
  },
  "/pal": async (page, acts) => { await tryClick(page, "[data-primary-action] button", "primary", acts); },
  "/out": async (page, acts) => { await tryClick(page, "main button >> nth=0", "first button", acts); },
  "/places": async (page, acts) => { await tryClick(page, "main button >> nth=0", "first button", acts); },
};

const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
for (const route of ROUTES) {
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    const page = await ctx.newPage();
  await stubBasemap(page);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 });
    await page.addInitScript(PROBE);
    await page.addInitScript(() => document.addEventListener("click", (e) => { if (e.target?.closest?.("a[href]")) e.preventDefault(); }, true));
    const acts = [];
    let status = 0;
    try {
      const resp = await page.goto(base + route, { waitUntil: "load", timeout: 180000 });
      status = resp?.status() ?? 0;
      await page.waitForTimeout(12000); // late banners, toasts, packs
      // a person scrolls: shifts during scroll are NOT excluded by hadRecentInput
      await page.mouse.wheel(0, 600); await page.waitForTimeout(1500);
      await page.mouse.wheel(0, -600); await page.waitForTimeout(1500);
      const tap = INTERACT[route.startsWith("/u/") ? "/out" : route];
      if (tap) await tap(page, acts);
      await page.waitForTimeout(2000);
    } catch (e) { acts.push("ERR " + String(e).slice(0, 120)); }
    const lab = await page.evaluate(() => window.__lab).catch(() => ({ shifts: [], longtasks: [], events: [] }));
    const byId = new Map();
    for (const e of lab.events) { const p = byId.get(e.id); if (!p || e.d > p.d) byId.set(e.id, e); }
    const inter = [...byId.values()].sort((a, b) => b.d - a.d);
    const r = { route, run, status, acts, cls: sessionCls(lab.shifts), inp: inter[0]?.d ?? 0, interactions: inter, shifts: lab.shifts,
      longtasks: lab.longtasks, tbtLike: lab.longtasks.reduce((s, x) => s + Math.max(0, x.d - 50), 0) };
    results.push(r);
    console.log(`${route} #${run} status=${status} cls=${r.cls.toFixed(4)} inp=${r.inp} longtasks=${lab.longtasks.length} maxLT=${Math.max(0, ...lab.longtasks.map((x) => x.d))} acts=${acts.join("|")}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 1));
