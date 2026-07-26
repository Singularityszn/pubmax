import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { window.localStorage.setItem("pubmax-tour-v1-done", "1"); });
const pending = new Map();
page.on("request", (r) => pending.set(r.url(), Date.now()));
page.on("requestfinished", (r) => pending.delete(r.url()));
page.on("requestfailed", (r) => { console.log("FAIL:", r.url().slice(0, 110), r.failure()?.errorText); pending.delete(r.url()); });
await page.goto("http://localhost:3100/map?sel=venue-16pnwmm", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let t = 10; t <= 90; t += 10) {
  await page.waitForTimeout(10000);
  const has = await page.evaluate(() => Boolean(document.querySelector(".venuePriceSubmit")));
  console.log(`t=${t}s vps=${has} pending=${[...pending.keys()].map(u => u.slice(0, 90)).join(" | ") || "none"}`);
  if (has) break;
}
await browser.close();
