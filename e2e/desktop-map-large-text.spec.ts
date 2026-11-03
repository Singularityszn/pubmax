import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";
import { storeThemeChoice } from "./helpers/themeClock";

test.use({ serviceWorkers: "block" });

for (const theme of ["light", "dark"] as const) for (const fontSize of [16, 32]) {
  test(`desktop toolbar controls remain separate at ${fontSize}px browser text in ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await storeThemeChoice(page, theme);
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize } });
    await page.goto("/map?wild=0");
    await expectMapLoadingFrameReleased(page);
    await expect(page.locator(".mapSplitList")).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(`${fontSize}px`);
    const toolbar = page.locator(".mapToolbar");
    const controls = [toolbar.getByRole("combobox", { name: "Search pubs" }), toolbar.locator(".mapVenueKindFilterBtn"), toolbar.locator(".mapToolbarDrinkLaneBtn"), toolbar.locator(".planBtn"), toolbar.locator(".citySwitcherTrigger")];
    for (const control of controls) await expect(control).toBeVisible();
    const boxes = await Promise.all(controls.map((control) => control.boundingBox()));
    await info.attach(`toolbar-${theme}-${fontSize}-geometry`, { body: JSON.stringify(boxes), contentType: "application/json" });
    const shot = await page.screenshot();
    await info.attach(`toolbar-${theme}-${fontSize}-viewport`, { body: shot, contentType: "image/png" });
    if (process.env.R5_PROOF_DIR) {
      await mkdir(process.env.R5_PROOF_DIR, { recursive: true });
      await writeFile(path.join(process.env.R5_PROOF_DIR, `toolbar-${theme}-${fontSize}.png`), shot);
      await writeFile(path.join(process.env.R5_PROOF_DIR, `toolbar-${theme}-${fontSize}.json`), JSON.stringify(boxes, null, 2));
    }
    await controls[0]!.focus();
    for (const control of controls.slice(1)) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();
    }
    const filter = controls[1]!;
    await filter.focus();
    await page.keyboard.press("Space");
    await expect(filter).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i]!;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(1440);
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j]!;
        const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
        expect(overlap, `controls ${i} and ${j} overlap`).toBe(false);
      }
    }
  });
}
