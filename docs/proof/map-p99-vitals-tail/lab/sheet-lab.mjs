// /map venue sheet: CLS while the sheet fills, and INP of selecting venues.
// usage: node sheet-lab.mjs <base> <out.json> [runs]
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { stubBasemap } from "./basemap.mjs";
import { PROBE, sessionCls } from "./probe.mjs";
const [base, out, runsArg] = process.argv.slice(2);
const RUNS = Number(runsArg ?? 3);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
for (let run = 0; run < RUNS; run++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  const page = await ctx.newPage();
  await stubBasemap(page);
  // DELAY_DETAIL_MS: hold /api/venue/[id] so the inspector chunk lands first,
  // which is the order on every open after a session's first (chunk cached).
  if (process.env.DELAY_DETAIL_MS) {
    await page.route(/\/api\/venue\/[^/?]+(\?|$)/, async (route) => {
      await new Promise((r) => setTimeout(r, Number(process.env.DELAY_DETAIL_MS)));
      await route.continue();
    });
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 });
  await page.addInitScript(PROBE);
  const acts = [];
  const taps = [];
  await page.goto(base + "/map", { waitUntil: "load", timeout: 180000 });
  await page.locator("canvas.maplibregl-canvas").first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(20000);
  await page.locator(".mapArrivalCardClose").click({ timeout: 30000 }).catch(() => acts.push("no arrival"));
  await page.waitForTimeout(2000);
  // Select a venue the way a thumb does from the resting map: the peek's answer
  // row (the cheapest pint in view). Close and reselect; each pass is a selection.
  for (let i = 0; i < 1; i++) {
    const answer = page.locator(".mapPeekAnswer:not(.isQuiet)").first();
    const ok = await answer.waitFor({ timeout: 30000 }).then(() => true, () => false);
    if (!ok) { acts.push("no peek answer"); break; }
    await page.evaluate(() => {
      const w = window; w.__frames = []; let last = "";
      const tick = () => {
        const insp = document.querySelector(".venueInspector");
        const sk = [...document.querySelectorAll(".venueSheetSkeleton")].map((e) => { const r = e.getBoundingClientRect(); return `sk@${Math.round(r.y)}h${Math.round(r.height)}`; }).join(",");
        let hidden = "";
        for (let e = insp; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || cs.contentVisibility === "hidden") { hidden = e.className + ":" + cs.display + "/" + cs.visibility; break; } }
        const r = insp?.getBoundingClientRect();
        const body = document.querySelector(".mobileSharedSheetBody");
        const kids = body ? [...body.children].map((c) => { const rr = c.getBoundingClientRect(); return `${(c.className||c.tagName).toString().split(" ")[0]}@${Math.round(rr.y)}h${Math.round(rr.height)}${getComputedStyle(c).display==="none"?"(none)":""}`; }).join(" | ") : "";
        const key = `${insp ? `insp@${Math.round(r.y)}h${Math.round(r.height)}` : "noinsp"} hidden=${hidden} ${sk} BODY ${kids}`;
        if (key !== last) { w.__frames.push(Math.round(performance.now()) + " " + key); last = key; }
        if (w.__frames.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const tapAt = await page.evaluate(() => performance.now());
    taps.push(tapAt);
    await answer.click({ noWaitAfter: true });
    const opened = await page.locator(".venueInspector").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
    acts.push("select" + (opened ? "" : " (no sheet)"));
    if (process.env.SHOT) await page.screenshot({ path: `sel-${i}.png` });
    await page.waitForTimeout(9000); // the sheet fills: drops, tonight chips, hygiene, visit notes
    if (i < 3) {
      await page.locator(".mobileSheetPortal .surfaceNavHome").first().click({ noWaitAfter: true }).catch(() => acts.push("no close"));
      await page.waitForTimeout(4000);
    }
  }
  const tabs = page.locator(".venueInspector [role='tab']");
  const n = await tabs.count();
  for (let i = 1; i < Math.min(n, 3); i++) { await tabs.nth(i).click({ noWaitAfter: true }).catch(() => {}); acts.push("tab" + i); await page.waitForTimeout(3000); }
  const lab = await page.evaluate(() => window.__lab);
  lab.frames = await page.evaluate(() => window.__frames);
  const byId = new Map();
  for (const e of lab.events) { const p = byId.get(e.id); if (!p || e.d > p.d) byId.set(e.id, e); }
  const inter = [...byId.values()].sort((a, b) => b.d - a.d);
  const after = taps.length ? lab.longtasks.filter((l) => l.t >= taps[0] && l.t < taps[0] + 8000) : [];
  const ltAfter = after.reduce((a, l) => a + l.d, 0);
  const r = { run, acts, ltAfter, ltAfterCount: after.length, cls: sessionCls(lab.shifts), inp: inter[0]?.d ?? 0, interactions: inter, shifts: lab.shifts, frames: lab.frames, longtasks: lab.longtasks };
  results.push(r);
  console.log(`sheet #${run} ltAfter8s=${ltAfter}ms/${after.length} cls=${r.cls.toFixed(4)} inp=${r.inp} shifts=${lab.shifts.length} acts=${acts.join("|")} inter=${inter.slice(0,6).map((x) => x.name + ":" + Math.round(x.d)).join(",")}`);
  await ctx.close();
}
await browser.close();
writeFileSync(out, JSON.stringify(results, null, 1));
