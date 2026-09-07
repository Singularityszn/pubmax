import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const OUT = "/Users/karanmanoharan/karan-agent-workspace/data/astra-live-walk";
const SHOTS = path.join(OUT, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = "https://pubmaxxing.com";

const PROFILES = {
  "phone-slow4g": {
    viewport: { width: 390, height: 844 },
    dsf: 3,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    cpu: 4,
    net: { offline: false, latency: 150, downloadThroughput: 188743, uploadThroughput: 86400 },
  },
  "phone-fast": {
    viewport: { width: 390, height: 844 },
    dsf: 3,
    mobile: true,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    cpu: 1,
    net: null,
  },
  desktop: {
    viewport: { width: 1440, height: 900 },
    dsf: 2,
    mobile: false,
    ua: null,
    cpu: 1,
    net: null,
  },
};

const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(",")
  : ["/", "/map", "/map/london", "/pubs", "/drinks", "/out", "/tonight", "/today", "/near", "/places", "/social", "/crawls", "/spoons-value", "/pal", "/onboarding", "/about", "/you", "/nope-404-check"];

const slug = (r) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[/?=&]/g, "-"));

const VITALS = `
window.__v = { lcp: 0, cls: 0, fcp: 0, longTasks: 0, shifts: [] };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__v.cls += e.value; window.__v.shifts.push({ v: e.value, t: e.startTime, s: (e.sources||[]).map(s=>s.node && s.node.nodeName ? (s.node.nodeName + (s.node.className && typeof s.node.className === 'string' ? '.'+s.node.className.split(' ').slice(0,2).join('.') : '')) : '?') }); } }).observe({ type: "layout-shift", buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__v.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
} catch {}
try {
  new PerformanceObserver((l) => { window.__v.longTasks += l.getEntries().length; }).observe({ type: "longtask", buffered: true });
} catch {}
`;

async function measure(browser, profName, route) {
  const p = PROFILES[profName];
  const ctx = await browser.newContext({
    viewport: p.viewport,
    deviceScaleFactor: p.dsf,
    isMobile: p.mobile,
    hasTouch: p.mobile,
    userAgent: p.ua ?? undefined,
    locale: "en-GB",
    timezoneId: "Europe/London",
  });
  const page = await ctx.newPage();
  await page.addInitScript(VITALS);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (p.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  if (p.net) await cdp.send("Network.emulateNetworkConditions", { ...p.net, connectionType: "cellular4g" });

  const console_ = [];
  const failed = [];
  const responses = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console_.push({ t: m.type(), text: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => console_.push({ t: "pageerror", text: String(e).slice(0, 400) }));
  page.on("requestfailed", (r) => failed.push({ url: r.url().slice(0, 200), err: r.failure()?.errorText }));
  page.on("response", (r) => { if (r.status() >= 400) responses.push({ url: r.url().slice(0, 200), status: r.status() }); });

  const t0 = Date.now();
  let status = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 90000 });
    status = resp?.status() ?? null;
  } catch (e) {
    console_.push({ t: "naverror", text: String(e).slice(0, 300) });
  }
  // settle
  try { await page.waitForLoadState("load", { timeout: 60000 }); } catch {}
  await page.waitForTimeout(p.cpu > 1 ? 9000 : 5000);

  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const res = performance.getEntriesByType("resource");
    let bytes = (nav.transferSize || 0);
    let decoded = (nav.decodedBodySize || 0);
    const byType = {};
    for (const r of res) {
      bytes += r.transferSize || 0;
      decoded += r.decodedBodySize || 0;
      const t = r.initiatorType || "other";
      byType[t] = byType[t] || { n: 0, b: 0 };
      byType[t].n++; byType[t].b += r.transferSize || 0;
    }
    const heavy = res.slice().sort((a,b)=>(b.transferSize||0)-(a.transferSize||0)).slice(0,8).map(r=>({u:r.name.replace(location.origin,'').slice(0,110), kb: Math.round((r.transferSize||0)/1024), ms: Math.round(r.duration)}));
    const h1 = document.querySelector("h1");
    const main = document.querySelector("main") || document.body;
    const firstText = (main.innerText || "").trim().split("\n").filter(Boolean).slice(0, 14);
    const btns = Array.from(document.querySelectorAll("button, a[href], [role=button], [role=tab]"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0; })
      .map((el) => ({ tag: el.tagName, t: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g," ").slice(0, 50), href: el.getAttribute("href") || undefined }))
      .filter((x) => x.t);
    const primary = Array.from(document.querySelectorAll("[data-primary-action]")).map(e=>(e.innerText||"").trim().slice(0,40));
    return {
      ttfb: Math.round((nav.responseStart || 0) - (nav.requestStart || 0)),
      respStart: Math.round(nav.responseStart || 0),
      domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      fcp: Math.round(window.__v?.fcp || 0),
      lcp: Math.round(window.__v?.lcp || 0),
      cls: Number((window.__v?.cls || 0).toFixed(4)),
      shifts: (window.__v?.shifts||[]).sort((a,b)=>b.v-a.v).slice(0,3),
      longTasks: window.__v?.longTasks || 0,
      requests: res.length + 1,
      transferKB: Math.round(bytes / 1024),
      decodedKB: Math.round(decoded / 1024),
      byType,
      heavy,
      h1: h1 ? h1.innerText.trim().slice(0, 120) : null,
      title: document.title,
      firstText,
      controls: btns.slice(0, 45),
      controlCount: btns.length,
      primary,
    };
  });

  const name = `${slug(route)}-${p.viewport.width}-${profName}.png`;
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: false });
  const nameFull = `${slug(route)}-${p.viewport.width}-${profName}-full.png`;
  try { await page.screenshot({ path: path.join(SHOTS, nameFull), fullPage: true }); } catch {}

  const out = { route, profile: profName, status, wall: Date.now() - t0, ...data, console: console_.slice(0, 25), failed: failed.slice(0, 15), http4xx5xx: responses.slice(0, 15), shot: name };
  await ctx.close();
  return out;
}

const browser = await chromium.launch();
const results = [];
const profs = process.env.PROFILES ? process.env.PROFILES.split(",") : Object.keys(PROFILES);
for (const prof of profs) {
  for (const route of ROUTES) {
    process.stderr.write(`${prof} ${route} ... `);
    try {
      const r = await measure(browser, prof, route);
      results.push(r);
      process.stderr.write(`ttfb=${r.ttfb} fcp=${r.fcp} lcp=${r.lcp} req=${r.requests} kb=${r.transferKB} cls=${r.cls} err=${r.console.length}\n`);
    } catch (e) {
      process.stderr.write(`FAIL ${e}\n`);
      results.push({ route, profile: prof, error: String(e) });
    }
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, `raw-${profs.join("_")}.json`), JSON.stringify(results, null, 2));
console.log("done", results.length);
