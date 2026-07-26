import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:3100/map?sel=venue-16pnwmm", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(20000);
const r = await page.evaluate(() => ({
  canvases: document.querySelectorAll("canvas").length,
  fallback: document.querySelector(".mapFallback, [data-map-fallback]")?.innerText?.slice(0, 300) ?? null,
  stage: document.querySelector(".mapStage")?.innerHTML.length ?? null,
  stageChildren: [...(document.querySelector(".mapStage")?.children ?? [])].map((c) => c.className || c.tagName).slice(0, 12),
}));
console.log(JSON.stringify(r, null, 1));
await browser.close();
