import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
await page.addInitScript(() => {
  window.localStorage.setItem("pubmax-tour-v1-done", "1");
});
await page.goto("http://localhost:3100/map", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let t = 10; t <= 60; t += 10) {
  await page.waitForTimeout(10000);
  const ov = await page.evaluate(() => Boolean(document.querySelector(".mapLoading")));
  console.log(`t=${t}s overlay=${ov}`);
  if (!ov) break;
}
const r = await cdp.send("Page.captureScreenshot", {});
writeFileSync(process.env.OUT || "paint2.png", Buffer.from(r.data, "base64"));
console.log("saved");
await browser.close();
