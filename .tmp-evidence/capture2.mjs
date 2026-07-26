// Manual visual evidence: first uncorroborated pint report -> provisional badge
// on the pin, pin colour unchanged, hover card explains the dot.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const VENUE = "venue-16pnwmm";
const OUT = process.env.OUT_DIR || ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const cdp = await page.context().newCDPSession(page);
async function shot(name, clip) {
  const r = await cdp.send("Page.captureScreenshot", clip ? { clip: { ...clip, scale: 1 } } : {});
  writeFileSync(`${OUT}/${name}`, Buffer.from(r.data, "base64"));
  console.log("WROTE", name);
}
await page.addInitScript(() => {
  window.localStorage.setItem("pubmax-tour-v1-done", "1");
  window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/map?sel=${VENUE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas", { state: "attached", timeout: 60000 });
for (let t = 0; t < 60; t += 5) {
  await page.waitForTimeout(5000);
  if (!(await page.evaluate(() => Boolean(document.querySelector(".mapLoading"))))) break;
}
await page.waitForTimeout(4000); // camera fly + tiles settle
const dismiss = page.locator("button", { hasText: "Dismiss / explore the map" });
if (await dismiss.count()) await dismiss.click().catch(() => {});

const skip = page.locator("button", { hasText: "Skip the tour" });
if (await skip.count()) await skip.click().catch(() => {});
await page.waitForTimeout(1000);

const retry = page.locator("button", { hasText: "Retry" });
if (await retry.count()) { await retry.first().click().catch(() => {}); await page.waitForTimeout(8000); }
await page.waitForSelector(".venuePriceSubmit", { state: "attached", timeout: 90000 });
await page.waitForTimeout(1000);
// BEFORE: selected pin, no community report yet.
await shot("1-before-submit.png");

// Submit tonight's pint price via the sheet's card.
const submit = page.locator(".venuePriceSubmit").first();
await submit.evaluate((el) => el.scrollIntoView({ block: "center" }));
await page.waitForTimeout(500);
await submit.locator(".vpsubInput").evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  el.focus(); set.call(el, "4.40");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.waitForTimeout(500);
await page.waitForFunction(() => {
  const b = document.querySelector(".venuePriceSubmit .vpsubLog");
  return b && !b.disabled;
}, { timeout: 20000 });
await submit.locator(".vpsubLog").evaluate((el) => el.click());
try {
  await page.waitForSelector(".vpsubStamp", { timeout: 45000 });
} catch (e) {
  console.log("STAMP TIMEOUT. card text:", (await submit.innerText()).replace(/\n+/g, " | "));
  throw e;
}
await page.waitForTimeout(800);
const sb = await submit.boundingBox();
if (sb) await shot("2-receipt-marked-on-map.png", { x: sb.x - 8, y: sb.y - 8, width: sb.width + 16, height: sb.height + 16 });
console.log("RECEIPT:", (await submit.innerText()).replace(/\n+/g, " | "));

// AFTER: pin now wears the provisional dot (selected pin).
await page.waitForTimeout(1500);
await shot("3-after-submit-map.png");

// Deselect so the ordinary pin shows the badge, then hover it for the card.
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(2500);
await shot("4-deselected-map.png");

const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
if (box) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  outer: for (let dx = -80; dx <= 80; dx += 10) {
    for (let dy = -80; dy <= 80; dy += 10) {
      await page.mouse.move(cx + dx, cy + dy);
      await page.waitForTimeout(100);
      if (await page.locator(".venueHoverPending").count()) break outer;
    }
  }
  if (await page.locator(".venueHoverPending").count()) {
    await page.waitForTimeout(300);
    await shot("5-hover-card-pending-note.png");
    console.log("HOVER_NOTE:", await page.locator(".venueHoverPending").innerText());
  } else {
    console.log("HOVER_NOTE: not captured");
  }
}
console.log("PAGE_ERRORS:", JSON.stringify(errors));
await browser.close();
