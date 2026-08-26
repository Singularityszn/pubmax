import { expect, test, type Locator, type Page } from "@playwright/test";

type PaintedMapTapPoint = {
  kind: "pin" | "cluster";
  x: number;
  y: number;
};

async function paintedMarks(page: Page): Promise<PaintedMapTapPoint[]> {
  return page.evaluate(() =>
    (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => PaintedMapTapPoint[];
      }
    ).__pubmaxPaintedMapTapPoints?.() ?? [],
  );
}

async function openVenueFromMap(
  page: Page,
): Promise<{ inspector: Locator; tapStartedAt: number }> {
  await page.goto("/map");
  const inspector = page.locator(".venueInspector");
  await expect
    .poll(async () => (await paintedMarks(page)).length, {
      message: "the map paints a tappable pub mark",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  const marks = await paintedMarks(page);
  const target = marks.find((mark) => mark.kind === "pin");
  if (!target) throw new Error("map painted no tappable venue pin");
  const tapStartedAt = await page.evaluate(() => performance.now());
  await page.mouse.click(target.x, target.y);
  await expect(inspector).toBeVisible();
  return { inspector, tapStartedAt };
}

test.describe("venue reveal reduced motion", () => {
  test("skips entrance classes under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await openVenueFromMap(page);

    await page.waitForTimeout(600);

    const revealClasses = await page.evaluate(() => {
      const inspector = document.querySelector(".venueInspector");
      if (!inspector) throw new Error("venue inspector missing");
      return {
        className: inspector.className,
        dataReveal: inspector.getAttribute("data-reveal"),
        bloomAnimation: getComputedStyle(
          document.querySelector(".venueRevealBloom") ?? document.body,
        ).animationName,
      };
    });

    expect(revealClasses.className).not.toMatch(/venueReveal/);
    expect(revealClasses.dataReveal).toBeNull();
    expect(revealClasses.bloomAnimation).not.toMatch(/venueRevealBloom/);
  });

  test("keeps the price figure outside reveal animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const { inspector, tapStartedAt } = await openVenueFromMap(page);
    await page.waitForFunction(
      () => document.querySelector(".venueInspector")?.classList.contains("venueReveal") === true,
      undefined,
      { timeout: 200, polling: 10 },
    );
    const revealDelay = await page.evaluate(
      (startedAt) => performance.now() - startedAt,
      tapStartedAt,
    );
    expect(revealDelay).toBeLessThanOrEqual(200);
    const figure = inspector.locator(".priceBadge").first();
    await expect(figure).toBeVisible();
    await expect.poll(() => figure.evaluate((node) => getComputedStyle(node).animationName)).not.toMatch(
      /venueReveal/,
    );
  });
});
