import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const TAG = process.env.TAG ?? "local";
const OUT = "docs/proof/walk-bugs-one-liners/shots";
const b = await chromium.launch();

// B6: /onboarding
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const navs = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navs.push(f.url()); });
  const onboarding = [];
  p.on("response", async (r) => {
    if (!r.url().endsWith("/onboarding")) return;
    let bytes = 0;
    try { bytes = (await r.body()).byteLength; } catch {}
    onboarding.push({ status: r.status(), bytes });
  });
  const t0 = Date.now();
  await p.goto(`${BASE}/onboarding`, { waitUntil: "load" });
  const lcp = await p.evaluate(() => new Promise((res) => {
    let v = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) v = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    setTimeout(() => res(Math.round(v)), 2500);
  }));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/b6-onboarding-${TAG}.png` });
  console.log(`B6 ${TAG}: landed=${p.url()} navs=${navs.length} onboardingResponses=${JSON.stringify(onboarding)} lcpMs=${lcp} loadMs=${Date.now() - t0} title=${JSON.stringify(await p.title())}`);
  await p.close();
}

// B7: 404
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const warnings = [];
  p.on("console", (m) => { if (m.type() === "warning") warnings.push(m.text()); });
  await p.goto(`${BASE}/this-page-does-not-exist`, { waitUntil: "load" });
  await p.waitForTimeout(4000);
  const styles = await p.evaluate(() => {
    const pre = [...document.querySelectorAll('link[rel="preload"][as="style"]')].map((l) => l.getAttribute("href"));
    const used = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")));
    return { preloads: pre.length, unused: pre.filter((h) => !used.has(h)).length };
  });
  const unusedWarnings = warnings.filter((w) => w.includes("preloaded using link preload but not used")).length;
  await p.screenshot({ path: `${OUT}/b7-404-${TAG}.png` });
  console.log(`B7 ${TAG}: title=${JSON.stringify(await p.title())} stylePreloads=${styles.preloads} unusedPreloads=${styles.unused} preloadWarnings=${unusedWarnings} totalWarnings=${warnings.length}`);
  await p.close();
}

// B8: /pubs images
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const images = [];
  p.on("response", async (r) => {
    if (!r.url().includes("/api/image-proxy")) return;
    try {
      const body = await r.body();
      images.push({ bytes: body.byteLength, type: r.headers()["content-type"] ?? "?", w: new URL(r.url()).searchParams.get("w") });
    } catch {}
  });
  await p.goto(`${BASE}/pubs`, { waitUntil: "load" });
  await p.waitForTimeout(1000);
  await p.evaluate(() => window.scrollTo(0, 1200));
  await p.waitForTimeout(4000);
  const total = images.reduce((a, i) => a + i.bytes, 0);
  await p.screenshot({ path: `${OUT}/b8-pubs-${TAG}.png` });
  console.log(`B8 ${TAG}: proxiedImages=${images.length} totalKB=${(total / 1024).toFixed(1)} widths=${JSON.stringify(images.map((i) => i.w))} types=${JSON.stringify([...new Set(images.map((i) => i.type))])}`);
  await p.close();
}
await b.close();
