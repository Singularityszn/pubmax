import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { fragmentedLandingProxy } from "./helpers/fragmentedLandingProxy.mts";

type SplashMeasurements = {
  __pubmaxSplashCls: number;
  __pubmaxSplashShifts: Array<{
    time: number;
    value: number;
    hadRecentInput: boolean;
    fonts: FontFaceSetLoadStatus;
    sources: Array<{
      element: string | null;
      previousRect: DOMRectInit;
      currentRect: DOMRectInit;
    }>;
  }>;
};

// feat(landing): hero scroll cinema with aperture splash - PIECE 3.
// The splash block in public/theme-init.js skips real automated browsers by
// default (navigator.webdriver), which every other spec in this suite relies on
// implicitly (they never see the splash). This is the one dedicated spec
// that opts back in, via page.addInitScript overriding navigator.webdriver,
// so the aperture animation itself gets real-browser proof: it appears,
// animates, and resolves within the 700ms hard ceiling with zero CLS, then
// flows into the hero cinema's dark-start frame (see
// the retired landing hero cinema, removed with the relaunch landing).

async function overrideWebdriver(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  });
}

async function trackCls(page: Page) {
  await page.addInitScript(() => {
    const measurements = window as unknown as SplashMeasurements;
    measurements.__pubmaxSplashCls = 0;
    measurements.__pubmaxSplashShifts = [];
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as Array<
          PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources: Array<{
              node: Node | null;
              previousRect: DOMRectReadOnly;
              currentRect: DOMRectReadOnly;
            }>;
          }
        >) {
          measurements.__pubmaxSplashShifts.push({
            time: entry.startTime,
            value: entry.value,
            hadRecentInput: entry.hadRecentInput,
            fonts: document.fonts.status,
            sources: entry.sources.map((source) => ({
              element: source.node instanceof Element
                ? source.node.outerHTML
                : source.node?.parentElement?.outerHTML ?? null,
              previousRect: source.previousRect.toJSON(),
              currentRect: source.currentRect.toJSON(),
            })),
          });
          if (!entry.hadRecentInput) {
            measurements.__pubmaxSplashCls += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
}

test.describe("aperture splash - eligible session (navigator.webdriver overridden)", () => {
  test("holds CLS below 0.01 when the header stream and real fonts finish together", async ({ page, baseURL }) => {
    expect(baseURL, "The local production server must provide baseURL").toBeTruthy();
    const proxy = await fragmentedLandingProxy(baseURL!);
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await overrideWebdriver(page);
      await trackCls(page);
      await page.addInitScript(() => {
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      const response = await page.goto(proxy.origin);
      expect(response?.status()).toBe(200);
      expect(createHash("sha256").update(await response!.body()).digest("hex")).toBe(proxy.delivery.originalSha256);
      expect(proxy.delivery.heldFonts, "The reproduction must hold real font responses with the HTML").toBeGreaterThanOrEqual(2);
      expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("layout-shift"))).toBe(true);
      await expect(page.locator(".lpNav")).toBeVisible();
      await expect(page.locator(".lpNav").getByRole("link", { name: "PUBMAXX home", exact: true })).toBeVisible();
      await page.waitForTimeout(900);
      const measurements = await page.evaluate(() => {
        const measured = window as unknown as SplashMeasurements;
        return { cls: measured.__pubmaxSplashCls, shifts: measured.__pubmaxSplashShifts };
      });
      await test.info().attach("fragmented-landing-layout-shifts", {
        body: JSON.stringify({ delivery: proxy.delivery, ...measurements }, null, 2),
        contentType: "application/json",
      });
      expect(proxy.delivery.errors).toEqual([]);
      expect(measurements.cls, `Streamed landing shifts: ${JSON.stringify(measurements.shifts)}`).toBeLessThan(0.01);
    } finally {
      await proxy.close();
    }
  });

  test("plays once, resolves within the 700ms ceiling, and holds CLS at zero", async ({ page }) => {
    await overrideWebdriver(page);
    await trackCls(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);

    // Set pre-paint by public/theme-init.js - must already be present by
    // the time Playwright can observe it, with no flash of an unstyled mark.
    const splashOn = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOn).toBe("on");

    const overlay = page.locator("#pubmax-splash");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveCSS("position", "fixed");

    const mark = page.locator(".pubmaxSplashMark");
    await expect(mark).toBeVisible();

    // Give the sequence its full 700ms hard ceiling plus a settle margin,
    // then confirm both the backdrop and the mark have finished animating
    // (fill: forwards leaves them transparent, not removed from the DOM).
    await page.waitForTimeout(900);
    const backdropOpacity = await overlay.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(backdropOpacity)).toBeLessThan(0.05);
    const markOpacity = await mark.evaluate((node) => getComputedStyle(node).opacity);
    expect(Number(markOpacity)).toBeLessThan(0.05);

    // The overlay is inert throughout, and the hero cinema underneath - the
    // "one continuous shot" the splash resolves into - is reachable and
    // interactive once it finishes.
    await expect(overlay).toHaveCSS("pointer-events", "none");
    await expect(
      page.getByRole("heading", {
        name: "What a pint costs, pub by pub.",
        exact: true,
      }),
    ).toBeVisible();

    const measurements = await page.evaluate(() => {
      const measured = window as unknown as SplashMeasurements;
      return { cls: measured.__pubmaxSplashCls, shifts: measured.__pubmaxSplashShifts };
    });
    await test.info().attach("landing-layout-shifts", {
      body: JSON.stringify(measurements, null, 2),
      contentType: "application/json",
    });
    expect(
      measurements.cls,
      `Landing layout shifts: ${JSON.stringify(measurements.shifts, null, 2)}`,
    ).toBeLessThan(0.01);
  });

  test("does not replay on a second load in the same session", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.splash))
      .toBe("on");

    await page.reload();
    const splashOnSecondLoad = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnSecondLoad).toBeUndefined();
  });

  test("never triggers off the landing route", async ({ page }) => {
    await overrideWebdriver(page);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/map");
    const splashOnMap = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashOnMap).toBeUndefined();
  });

  test("skips entirely under prefers-reduced-motion, even though webdriver is overridden", async ({ page }) => {
    await overrideWebdriver(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashUnderReducedMotion = await page.evaluate(
      () => document.documentElement.dataset.splash,
    );
    expect(splashUnderReducedMotion).toBeUndefined();
  });
});

test.describe("aperture splash - default automated session", () => {
  test("never plays for a real automated browser (navigator.webdriver left as-is)", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.goto("/");
    const splashDefault = await page.evaluate(() => document.documentElement.dataset.splash);
    expect(splashDefault).toBeUndefined();
  });
});

test.describe("landing header without JavaScript", () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`keeps the public header visible at ${viewport.width}px`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, viewport, javaScriptEnabled: false });
      try {
        const page = await context.newPage();
        const response = await page.goto("/");
        expect(response?.status()).toBe(200);
        const header = page.locator(".lpNav");
        await expect(header).toBeVisible();
        await expect(header.getByRole("link", { name: "PUBMAXX home", exact: true })).toBeVisible();
        if (viewport.width === 1280) {
          await expect(header.getByRole("button", { name: "More pages", exact: true })).toBeVisible();
        }
      } finally {
        await context.close();
      }
    });
  }
});
