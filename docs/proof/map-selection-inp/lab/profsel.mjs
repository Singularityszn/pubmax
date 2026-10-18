// Profile the /map venue-selection tap and map frames to source.
// usage: node profsel.mjs <base> <distDir> <out-prefix>
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { stubBasemap } from "./basemap.mjs";
const require = createRequire(`${process.cwd()}/`);
const { SourceMapConsumer } = require("source-map-js");
const [base, distDir, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const p = await ctx.newPage(); await stubBasemap(p);
const cdp = await ctx.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await p.addInitScript(() => { window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ n: e.name, d: e.duration, t: e.startTime }); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); });
await p.goto(base + "/map", { waitUntil: "load" });
await p.waitForTimeout(20000);
await p.locator(".mapArrivalCardClose").click().catch(() => {});
await p.waitForTimeout(3000);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
await cdp.send("Profiler.start");
await p.waitForTimeout(1500);
const t0 = await p.evaluate(() => { const fn = function __TAP_MARKER__() { const e = performance.now() + 30; while (performance.now() < e) { /* mark */ } }; fn(); return performance.now(); });
await p.locator(".mapPeekAnswer:not(.isQuiet)").click({ noWaitAfter: true });
await p.waitForTimeout(2500);
const { profile } = await cdp.send("Profiler.stop");
const ev = await p.evaluate((t) => window.__ev.filter((e) => e.t >= t - 50), t0);
await b.close();
writeFileSync(out + ".cpuprofile", JSON.stringify(profile));
const tapEv = ev.sort((a, c) => c.d - a.d)[0];
console.log("interaction", JSON.stringify(ev));
// window: profile time is in microseconds since profile.startTime; restrict to tap frame
const winMs = tapEv ? tapEv.d + 20 : 1200;
const consumers = new Map();
function consumerFor(url) {
  if (consumers.has(url)) return consumers.get(url);
  let c = null;
  const m = url.match(/\/_next\/(static\/.*?\.js)/);
  if (m) {
    const js = `${distDir}/${m[1]}`;
    if (existsSync(js)) {
      const tail = readFileSync(js, "utf8").slice(-300).match(/sourceMappingURL=(\S+)/);
      const f = tail ? js.replace(/[^/]+$/, tail[1]) : `${js}.map`;
      if (existsSync(f)) c = new SourceMapConsumer(JSON.parse(readFileSync(f, "utf8")));
    }
  }
  consumers.set(url, c); return c;
}
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
const label = new Map();
function lab(id) {
  if (label.has(id)) return label.get(id);
  const f = byId.get(id).callFrame; let s = `${f.functionName || "(anon)"}`;
  const c = f.url ? consumerFor(f.url) : null;
  if (c) { const o = c.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }); if (o.source) s = `${o.name || f.functionName || "(anon)"} @ ${o.source.replace(/.*?\/(components|lib|app|node_modules\/[^/]+)\//, "$1/")}:${o.line}`; }
  else if (!f.url) s = f.functionName || "(native)";
  label.set(id, s); return s;
}
// Start the window at the marker's first sample.
let startIdx = 0; { for (let i = 0; i < profile.samples.length; i++) { if (byId.get(profile.samples[i]).callFrame.functionName === "__TAP_MARKER__") { startIdx = i; break; } } }
let tUs = 0; const self = new Map(), incl = new Map(), file = new Map(); let total = 0;
profile.samples.forEach((id, i) => {
  if (i < startIdx) return;
  tUs += i === startIdx ? 0 : profile.timeDeltas[i];
  const tMs = tUs / 1000;
  if (tMs > winMs + 50) return; // only the tap's frame (profile starts right before the tap)
  const dt = (profile.timeDeltas[i + 1] ?? 100) / 1000; total += dt;
  const s = lab(id); self.set(s, (self.get(s) || 0) + dt);
  const seen = new Set(), seenF = new Set(); let cur = id;
  while (cur) { const l = lab(cur); if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) || 0) + dt); }
    const fm = l.match(/@ ((components|app|lib)\/[^:]+)/); if (fm && !seenF.has(fm[1])) { seenF.add(fm[1]); file.set(fm[1], (file.get(fm[1]) || 0) + dt); }
    cur = parent.get(cur); }
});
const top = (m, n) => [...m].sort((a, c) => c[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)}ms ${k}`).join("\n");
const report = `window ${winMs.toFixed(0)}ms, sampled ${total.toFixed(0)}ms\n--- self\n${top(self, 30)}\n--- inclusive (app frames)\n${top(new Map([...incl].filter(([k]) => /@ (components|app|lib)\//.test(k))), 60)}\n--- by file (inclusive)\n${top(file, 30)}`;
writeFileSync(out + ".txt", report); console.log(report);
