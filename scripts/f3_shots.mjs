// F3 screenshot gate — captures the concierge-as-map-home affordance on the map
// with a real software WebGL2 context (SwiftShader), on an isolated port. Shots
// land in docs/screenshots/f3/. "before" hides the concierge pill (display:none)
// to show the prior map-home; "after" shows the F3 collapsed pill + open panel.
import { chromium } from "@playwright/test";

const BASE = process.env.F3_BASE_URL ?? "http://localhost:3187";
const OUT = "docs/screenshots/f3";

const THEMES = ["light", "dark"];

async function run() {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  for (const theme of THEMES) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript((t) => {
      window.localStorage.setItem("pubmax-theme", t);
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      // Suppress the §4.5 "Start with a story" onboarding overlay so it never
      // intercepts the concierge pill click.
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const page = await context.newPage();
    await page.goto(`${BASE}/map`, { waitUntil: "load" });
    await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20000 });
    await page.waitForTimeout(2500);

    // BEFORE: hide the F3 affordance to show the prior bottom lane.
    await page.addStyleTag({ content: ".mapConciergeAsk{display:none !important}" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/before-map-${theme}.png` });

    // AFTER (collapsed): restore + show the first-class pill.
    await page.evaluate(() => {
      const style = [...document.querySelectorAll("style")].find((s) =>
        s.textContent?.includes(".mapConciergeAsk{display:none"),
      );
      style?.remove();
    });
    await page.locator(".mapConciergeAskPill").waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/after-collapsed-${theme}.png` });

    // AFTER (open): expand the panel — idle state with the input + example asks.
    // (The grounded happy-path needs a real Supabase-backed durable limiter,
    // which fails closed against placeholder creds locally, so we capture the
    // affordance itself rather than a locally-429'd answer.)
    await page.locator(".mapConciergeAskPill").click();
    await page.locator(".mapConciergeAskInput").waitFor({ state: "visible", timeout: 5000 });
    await page.locator(".mapConciergeAskInput").fill("Quiet-ish near Bank, 4 of us");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/after-open-${theme}.png` });

    await context.close();
  }
  await browser.close();
}

run().then(
  () => {
    console.log("F3 shots written to", OUT);
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
