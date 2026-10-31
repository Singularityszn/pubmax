import { expect, test } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

for (const width of [390, 1440]) {
  for (const javaScriptEnabled of [false, true]) {
    test(`${width}px ${javaScriptEnabled ? "hydrated" : "without JavaScript"}: the generated font chains survive the global cascade`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({
        baseURL,
        javaScriptEnabled,
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      await storeThemeChoice(context, "light");
      try {
        const page = await context.newPage();
        await page.goto("/pal/chat");
        await expect(page.getByRole("heading", { name: "What's the night?", exact: true })).toBeVisible();
        const readFonts = () => page.evaluate(() => {
          const root = getComputedStyle(document.documentElement);
          const split = (value: string) => value.split(",").map((family) => family.trim().replace(/^["']|["']$/g, ""));
          return {
            display: split(root.getPropertyValue("--font-display")),
            body: split(root.getPropertyValue("--font-body")),
            renderedBody: split(getComputedStyle(document.body).fontFamily),
          };
        });
        const expected = {
          display: ["Space Grotesk", "Space Grotesk Fallback"],
          body: ["Inter", "Inter Fallback"],
          renderedBody: ["Inter", "Inter Fallback"],
        };
        await expect.poll(readFonts).toEqual(expected);
        if (javaScriptEnabled) {
          // Exercise the Appearance setting independently of the header button.
          await page.goto("/u/you");
          const appearance = page.getByTestId("appearance-pref");
          await expect(appearance).toBeVisible();
          await expect.poll(readFonts).toEqual(expected);
          await expect(async () => {
            await appearance.getByRole("button", { name: "Switch to dark theme", exact: true }).click();
            await expect(appearance.getByRole("button", { name: "Switch to light theme", exact: true })).toBeVisible({ timeout: 1_000 });
          }).toPass({ timeout: 20_000 });
          await expect.poll(readFonts).toEqual(expected);
        }
      } finally {
        await context.close();
      }
    });
  }
}
