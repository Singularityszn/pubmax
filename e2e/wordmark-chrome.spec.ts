import { expect, test } from "@playwright/test";

// 23:50 Europe/London (BST). /today is the one case whose nav reads the wall
// clock: past 17:00 the Now href is /tonight, and the document it hydrates
// against always says /today. That half of the day used to be walked only by a
// run that happened to start in the evening, and it is the half where the nav
// corrected the href mid-hydration and took the whole route - wordmark included
// - back to its loading shell. Pinned so the case is the same case at any hour.
const LONDON_EVENING = new Date("2026-08-16T22:50:00.000Z");

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
    clock: LONDON_EVENING,
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
    if ("clock" in view) await page.clock.setFixedTime(view.clock);
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
    const box = await wordmark.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(view.viewport.width);
    await expect(wordmark.locator(".pubmaxxWordmarkAccent")).toHaveCount(1);
    expect(
      await wordmark.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const visibleParts = root.querySelectorAll(
          ".pubmaxxWordmarkLetters, .pubmaxxWordmarkLetters > span",
        );
        return root.scrollWidth <= root.clientWidth && [...visibleParts].every((part) => {
          const box = part.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right;
        });
      }),
    ).toBe(true);
    const host = page.locator(view.hostSelector).first();
    const hostBox = await host.boundingBox();
    expect(hostBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(hostBox!.x);
    expect(box!.x + box!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width);
  });
}
