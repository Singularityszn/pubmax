import { expect, test } from "@playwright/test";

const CASES = [
  {
    label: "mobile landing",
    viewport: { width: 390, height: 844 },
    path: "/",
    selector: ".lpWordmark .pubmaxxWordmark",
    hostSelector: ".lpWordmark",
    paintedBeforeHydration: true,
  },
  {
    label: "mobile app navigation",
    viewport: { width: 390, height: 844 },
    path: "/today",
    selector: ".siteNavBrand .pubmaxxWordmark",
    hostSelector: ".siteNavBrand",
    paintedBeforeHydration: true,
  },
  {
    label: "desktop navigation",
    viewport: { width: 1440, height: 900 },
    path: "/map",
    selector: ".siteNavBrand .pubmaxxWordmark",
    hostSelector: ".siteNavBrand",
    // The /map nav mounts on the client, after hydration has already handed
    // the document the display face, so it has no fallback paint to check.
    paintedBeforeHydration: false,
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

    // Hold the app's JS until the fallback face has been measured. Hydration
    // is what clears the fallback-only --font-display, and a fast one can do
    // it before the first read, so without the hold that read could land in
    // either face. The server-rendered wordmark paints without any JS.
    let releaseScripts!: () => void;
    const scriptsHeld = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    const isAppChunk = (url: URL) =>
      url.pathname.startsWith("/_next/static/chunks/") && url.pathname.endsWith(".js");
    if (view.paintedBeforeHydration) {
      await page.route(isAppChunk, async (route) => {
        await scriptsHeld;
        await route.continue();
      });
    } else {
      releaseScripts();
    }

    const response = await page.goto(view.path, { waitUntil: "commit" });
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

    if (view.paintedBeforeHydration) {
      expect(
        await page.evaluate(() => document.documentElement.style.getPropertyValue("--font-display")),
        "the first read is in the fallback face",
      ).not.toBe("");
      await expectUncut();
      releaseScripts();
    }
    // Hydration replaces the fallback-only value with the complete generated
    // chain, so the display face leads it again (components/ThemeAttribute.tsx).
    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.style.getPropertyValue("--font-display")),
        { timeout: 45_000 },
      )
      .toMatch(/^\s*["']?Space Grotesk["']?\s*,/);
    await page.evaluate(async () => {
      // A layout first, so the display face's load has started before
      // fonts.ready is read.
      void document.body.getBoundingClientRect();
      await document.fonts.ready;
    });
    await expectUncut();
  });
}
