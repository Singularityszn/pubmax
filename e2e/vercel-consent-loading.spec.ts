import { expect, test } from "@playwright/test";

// VERCEL=1 must be present during both build and this test invocation to
// exercise the positive SDK path. Ordinary local builds keep both SDKs off.
for (const width of [390, 1280]) {
  for (const decision of [null, "denied", "granted"] as const) {
    test(`Vercel scripts respect ${decision ?? "unanswered"} consent at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((choice) => {
        if (choice) localStorage.setItem("pubmaxx:analytics-consent:v1", choice);
        else localStorage.removeItem("pubmaxx:analytics-consent:v1");
      }, decision);
      const scripts: string[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/_vercel/**", async (route) => {
        scripts.push(new URL(route.request().url()).pathname);
        await route.fulfill({ contentType: "application/javascript", body: "/* local SDK boundary */" });
      });
      await page.goto("/", { waitUntil: "load" });
      await expect(page.getByRole("main")).toBeVisible();
      if (decision === "granted" && process.env.VERCEL === "1") {
        await expect.poll(() => scripts.length).toBe(2);
        expect(scripts.sort()).toEqual(["/_vercel/insights/script.js", "/_vercel/speed-insights/script.js"]);
      } else {
        // A negative network assertion needs a bounded observation window
        // after load, because consent and dynamic imports run in effects.
        await page.waitForTimeout(1_000);
        expect(scripts).toEqual([]);
      }
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 && decision === null) {
        await page.screenshot({ path: testInfo.outputPath("mobile-after.png"), fullPage: true });
      }
    });
  }
}
