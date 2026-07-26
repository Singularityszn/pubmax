import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => { window.localStorage.setItem("pubmax-tour-v1-done", "1"); });
await page.goto("http://localhost:3100/map?sel=venue-16pnwmm", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector(".venuePriceSubmit", { state: "attached", timeout: 120000 });
await page.waitForTimeout(1500);
const input = page.locator(".venuePriceSubmit .vpsubInput");
await input.evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  el.focus(); set.call(el, "4.40");
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(800);
console.log("value:", await input.inputValue());
console.log("disabled:", await page.locator(".vpsubLog").isDisabled());
// try Playwright typing as fallback
if (await page.locator(".vpsubLog").isDisabled()) {
  await input.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await input.click({ force: true });
  await page.keyboard.type("4.40");
  await page.waitForTimeout(500);
  console.log("after type value:", await input.inputValue());
  console.log("after type disabled:", await page.locator(".vpsubLog").isDisabled());
}
await browser.close();
