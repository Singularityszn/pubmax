import { expect, test, type Page } from "@playwright/test";

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

async function openVenueFromMap(page: Page): Promise<void> {
  await page.goto("/map");
  const inspector = page.locator(".venueInspector");
  await expect
    .poll(async () => (await paintedMarks(page)).length, {
      message: "the map paints a tappable pub mark",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        if (await inspector.count()) return true;
        const marks = await paintedMarks(page);
        const target = marks.find((mark) => mark.kind === "pin") ?? marks[0];
        if (!target) return false;
        await page.mouse.click(target.x, target.y);
        await page.waitForTimeout(target.kind === "pin" ? 400 : 900);
        return (await inspector.count()) > 0;
      },
      { message: "a painted map pin opens venue detail", timeout: 90_000 },
    )
    .toBe(true);
  await expect(inspector).toBeVisible();
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
    await openVenueFromMap(page);
    const inspector = page.locator(".venueInspector");
    const figure = inspector.locator(".priceBadge").first();
    await expect(figure).toBeVisible();
    await expect.poll(() => figure.evaluate((node) => getComputedStyle(node).animationName)).not.toMatch(
      /venueReveal/,
    );
  });
});
