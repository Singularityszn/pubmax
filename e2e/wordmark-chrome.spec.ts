import { expect, test } from "@playwright/test";

const CASES = [
  {
    label: "mobile landing",
    viewport: { width: 390, height: 844 },
    path: "/",
    selector: ".lpWordmark .pubmaxxWordmark",
    hostSelector: ".lpWordmark",
  },
  {
    label: "mobile app navigation",
    viewport: { width: 390, height: 844 },
    path: "/today",
    selector: ".siteNavBrand .pubmaxxWordmark",
    hostSelector: ".siteNavBrand",
  },
  {
    label: "desktop navigation",
    viewport: { width: 1440, height: 900 },
    path: "/map",
    selector: ".siteNavBrand .pubmaxxWordmark",
    hostSelector: ".siteNavBrand",
  },
] as const;

for (const view of CASES) {
  test(`${view.label} shows an uncut PUBMAXX wordmark`, async ({ page }) => {
    await page.setViewportSize(view.viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });

    const response = await page.goto(view.path, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const wordmark = page.locator(view.selector).first();
    await expect(wordmark).toBeVisible({ timeout: 45_000 });
    await expect(wordmark).toHaveAccessibleName("PUBMAXX");
    await expect(wordmark.locator(".pubmaxxWordmarkAccent")).toHaveCount(1);

    // The document paints the metric-matched fallback face first, and the
    // display face is only requested after hydration, when ThemeAttribute
    // removes the inline fallback-only --font-display (app/layout.tsx). The
    // swap narrows the wordmark AND its host, so the two must be read in one
    // layout: read apart, a wordmark measured in the fallback face was held to
    // a host already measured in the display face (81.1 > 76.0 on CI). Each
    // face must leave the wordmark uncut, so both are checked.
    const expectUncut = async () => {
      const lockup = await wordmark.evaluate((root, hostSelector) => {
        const bounds = root.getBoundingClientRect();
        const host = root.closest(hostSelector)?.getBoundingClientRect() ?? null;
        const visibleParts = root.querySelectorAll(
          ".pubmaxxWordmarkLetters, .pubmaxxWordmarkLetters > span",
        );
        return {
          left: bounds.left,
          right: bounds.right,
          host: host && { left: host.left, right: host.right },
          lettersInside: root.scrollWidth <= root.clientWidth && [...visibleParts].every((part) => {
            const box = part.getBoundingClientRect();
            return box.left >= bounds.left && box.right <= bounds.right;
          }),
        };
      }, view.hostSelector);
      expect(lockup.left).toBeGreaterThanOrEqual(0);
      expect(lockup.right).toBeLessThanOrEqual(view.viewport.width);
      expect(lockup.lettersInside).toBe(true);
      expect(lockup.host).not.toBeNull();
      expect(lockup.left).toBeGreaterThanOrEqual(lockup.host!.left);
      expect(lockup.right).toBeLessThanOrEqual(lockup.host!.right);
    };

    await expectUncut();
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.style.getPropertyValue("--font-display")),
        { timeout: 45_000 },
      )
      .toBe("");
    await page.evaluate(async () => {
      // A layout first, so the display face's load has started before
      // fonts.ready is read.
      void document.body.getBoundingClientRect();
      await document.fonts.ready;
    });
    await expectUncut();
  });
}
