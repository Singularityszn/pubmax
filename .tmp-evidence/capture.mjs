// Manual visual evidence: first uncorroborated pint report -> provisional badge
// on the pin, pin colour unchanged, hover card explains the dot.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3100";
const VENUE = "venue-16pnwmm";
const OUT = process.env.OUT_DIR || ".";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  window.localStorage.setItem("pubmax-tour-v1-done", "1");
  window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
  window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/map?sel=${VENUE}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForSelector("canvas", { state: "attached", timeout: 60000 });
await page.waitForTimeout(15000); // let camera fly + tiles settle

// BEFORE: selected pin, no community report yet.
await page.screenshot({ path: `${OUT}/1-before-submit.png` });

// Submit tonight's pint price via the sheet's card.
const submit = page.locator(".venuePriceSubmit").first();
await submit.scrollIntoViewIfNeeded();
await submit.getByRole("textbox").fill("4.40");
await submit.getByRole("button", { name: "Log it" }).click();
await page.waitForSelector(".vpsubStamp", { timeout: 10000 });
await page.waitForTimeout(500);
await submit.screenshot({ path: `${OUT}/2-receipt-marked-on-map.png` });

// AFTER: pin now wears the provisional dot. Keep pub selected so the badge
// rides the enlarged selected pin; screenshot the map.
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/3-after-submit-map.png` });

// Deselect so the ordinary pin shows the badge, then hover it for the card.
const closeBtn = page.locator('[aria-label="Close"], .venueInspectorClose').first();
if (await closeBtn.count()) await closeBtn.click().catch(() => {});
await page.keyboard.press("Escape").catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/4-deselected-map.png` });

// Hover near map centre where the pub sits (camera centred it on select).
const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
if (box) {
  // sweep a small grid around centre until the hover card shows
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  outer: for (let dx = -60; dx <= 60; dx += 12) {
    for (let dy = -60; dy <= 60; dy += 12) {
      await page.mouse.move(cx + dx, cy + dy);
      await page.waitForTimeout(120);
      if (await page.locator(".venueHoverPending").count()) break outer;
    }
  }
  if (await page.locator(".venueHoverPending").count()) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/5-hover-card-pending-note.png` });
    console.log("HOVER_NOTE:", await page.locator(".venueHoverPending").innerText());
  } else {
    console.log("HOVER_NOTE: not captured");
  }
}

console.log("PAGE_ERRORS:", JSON.stringify(errors));
await browser.close();
