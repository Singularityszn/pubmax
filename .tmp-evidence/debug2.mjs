import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("requestfailed", (r) => console.log("FAILED:", r.url().slice(0, 120), r.failure()?.errorText));
await page.goto("http://localhost:3100/map?sel=venue-16pnwmm", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(5000);
  const n = await page.locator("canvas").count();
  console.log(`t=${(i + 1) * 5}s canvas=${n}`);
  if (n > 0) break;
}
const gl = await page.evaluate(() => {
  const c = document.createElement("canvas");
  return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
});
console.log("WEBGL:", gl);
await browser.close();
