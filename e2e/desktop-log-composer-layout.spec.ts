import { expect, test } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

for (const signedIn of [false, true]) {
  for (const { width, height, theme } of [
    { width: 1280, height: 720, theme: "light" },
    { width: 1280, height: 900, theme: "light" },
    { width: 1440, height: 900, theme: "light" },
    { width: 1280, height: 720, theme: "dark" },
  ] as const) {
    test(`desktop ${signedIn ? "signed-in" : "signed-out"} log intent keeps the price clear of the header at ${width}x${height} ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
      await page.addInitScript((value) => {
        localStorage.setItem("pubmax-theme", value);
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      if (signedIn) {
        await installAuthDoubles(page);
        await seedSignedIn(page, "A");
      }
      const response = await page.goto("/map?sel=venue-eltcmh&log=1");
      expect(response?.status()).toBe(200);
      const drawer = page.locator(".mapDrawer.right.open");
      const step = drawer.getByTestId("spill-price-step");
      await expect(step).toBeVisible();
      let previousTop: number | null = null;
      let stableReads = 0;
      await expect.poll(async () => {
        const top = await step.evaluate((node) => Math.round(node.getBoundingClientRect().top));
        stableReads = top === previousTop ? stableReads + 1 : 0;
        previousTop = top;
        return stableReads;
      }).toBeGreaterThanOrEqual(3);
      // The browser's native start-aligned reveal must leave space for the sticky header.
      await step.evaluate((node) => node.scrollIntoView({ block: "start", behavior: "instant" }));
      const geometry = await drawer.evaluate((node) => {
        const box = (selector: string) => {
          const element = node.querySelector<HTMLElement>(selector);
          if (!element) throw new Error(`Missing desktop composer element: ${selector}`);
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width };
        };
        const input = node.querySelector<HTMLInputElement>('[data-testid="spill-price-step"] input')!;
        const inputBox = input.getBoundingClientRect();
        return {
          header: box(".mapDrawerHead"),
          intro: box(".spillComposerIntro"),
          label: box(".priceFieldLabel"),
          columns: box(".venuePintsCols"),
          composer: box('form[aria-label="Pint Drop composer"]'),
          drops: box(".pintDrops"),
          priceInputHasPointer: document.elementFromPoint(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2) === input,
          viewport: { width: innerWidth, height: innerHeight },
          theme: document.documentElement.dataset.theme,
        };
      });
      await testInfo.attach("desktop-composer-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
      await page.screenshot({ path: testInfo.outputPath("desktop-composer.png") });
      expect(geometry.label.top, "price label must remain below the sticky header").toBeGreaterThanOrEqual(geometry.header.bottom);
      expect(geometry.intro.top, "the venue name and context stay below the sticky header").toBeGreaterThanOrEqual(geometry.header.bottom);
      expect(geometry.theme).toBe(theme);
      expect(geometry.priceInputHasPointer, "the price input must own its visible center").toBe(true);
      expect(geometry.composer.width, "the composer uses the drawer's reading width").toBeGreaterThanOrEqual(geometry.columns.width * 0.9);
      expect(geometry.drops.top, "the drop list follows the composer").toBeGreaterThanOrEqual(geometry.composer.bottom);
    });
  }
}
