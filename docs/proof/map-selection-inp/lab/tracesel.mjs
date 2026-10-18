// Trace the /map selection tap: main-thread tasks between the tap and the next presented frame.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { stubBasemap } from "./basemap.mjs";
const [base, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
const p = await ctx.newPage(); await stubBasemap(p);
await p.addInitScript(() => { window.__ev = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ n: e.name, d: e.duration, t: e.startTime, ps: e.processingStart, pe: e.processingEnd }); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); });
const cdp = await ctx.newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await p.goto(base + "/map", { waitUntil: "load" });
await p.waitForTimeout(20000);
await p.locator(".mapArrivalCardClose").click().catch(() => {});
await p.waitForTimeout(3000);
const events = [];
cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
await cdp.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "blink.user_timing", "latencyInfo"] }, transferMode: "ReportEvents" });
await p.waitForTimeout(500);
await p.locator(".mapPeekAnswer:not(.isQuiet)").click({ noWaitAfter: true });
await p.waitForTimeout(3000);
const ev = await p.evaluate(() => window.__ev);
console.log("event timing", JSON.stringify(ev.slice(-6)));
await cdp.send("Tracing.end"); await done;
await b.close();
writeFileSync(out, JSON.stringify(events));
// find renderer main thread
const names = events.filter((e) => e.name === "thread_name");
const main = names.find((e) => e.args?.name === "CrRendererMain" && events.some((x) => x.pid === e.pid && x.name === "EventDispatch"));
const onMain = events.filter((e) => e.pid === main.pid && e.tid === main.tid);
const click = onMain.find((e) => e.name === "EventDispatch" && e.args?.data?.type === "pointerdown");
const t0 = click.ts;
const tasks = onMain.filter((e) => e.name === "RunTask" && e.ph === "X" && e.ts >= t0 - 5000 && e.ts < t0 + 2500000).sort((a, c) => a.ts - c.ts);
const inside = (outer, e) => e.ts >= outer.ts && e.ts <= outer.ts + outer.dur;
const frames = onMain.filter((e) => /^(Commit|Paint|UpdateLayoutTree|Layout|PrePaint)$/.test(e.name) && e.ts >= t0);
console.log("first Paint after tap at", ((frames.find((e) => e.name === "Paint")?.ts - t0) / 1000).toFixed(0), "ms");
for (const t of tasks) {
  if (t.dur < (t.ts - t0 < 400000 ? 2000 : 15000)) continue;
  const kids = onMain.filter((e) => e !== t && inside(t, e) && e.dur);
  const disp = kids.filter((e) => e.name === "EventDispatch").map((e) => e.args.data.type);
  const fc = kids.filter((e) => e.name === "FunctionCall" || e.name === "TimerFire" || e.name === "FireAnimationFrame" || e.name === "EvaluateScript" || e.name === "v8.compile" ).map((e) => `${e.name}${e.args?.data?.functionName ? ":" + e.args.data.functionName : ""}${e.args?.data?.url ? "@" + e.args.data.url.split("/").pop().slice(0, 18) + ":" + e.args.data.lineNumber + ":" + e.args.data.columnNumber : ""}(${(e.dur / 1000).toFixed(0)})`).slice(0, 6);
  const lay = kids.filter((e) => /^(Layout|UpdateLayoutTree|Paint|PrePaint|Commit)$/.test(e.name)).reduce((s, e) => s + e.dur, 0);
  console.log(`+${((t.ts - t0) / 1000).toFixed(0).padStart(5)}ms dur ${(t.dur / 1000).toFixed(0).padStart(4)}ms layout/paint ${(lay / 1000).toFixed(0)}ms ${disp.join(",")} ${fc.join(" ")}`);
}
