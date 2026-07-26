import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => { if (/error|warn/i.test(m.type())) console.log("CON:", m.text().slice(0, 160)); });
await page.goto("http://localhost:3100/map", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(18000);
const r = await page.evaluate(() => {
  const c = document.querySelector(".mapCanvasWrap canvas");
  if (!c) return "no canvas";
  const rect = c.getBoundingClientRect();
  const overlay = document.querySelector(".mapLoading");
  return { w: c.width, h: c.height, cssW: rect.width, cssH: rect.height, overlayVisible: overlay ? getComputedStyle(overlay).display : "gone" };
});
console.log(JSON.stringify(r));
await browser.close();
