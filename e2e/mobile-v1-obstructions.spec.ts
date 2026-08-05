import { expect, test } from "@playwright/test";

const VENUE_ID = "venue-p7p18j";

test.setTimeout(120_000);

test.describe("V1 mobile obstructions", () => {
  test.use({
    viewport: { width: 400, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("Last train is fully discoverable when the venue sheet first opens", async ({
    page,
  }) => {
    await page.goto(`/map?sel=${VENUE_ID}`);

    const tablist = page.getByRole("tablist", {
      name: "Venue detail sections",
    });
    const lastTrain = tablist.getByRole("tab", {
      name: "Last train",
      exact: true,
    });

    await expect(tablist).toBeVisible({ timeout: 30_000 });
    await expect(lastTrain).toBeVisible();

    const [railBox, tabBox] = await Promise.all([
      tablist.boundingBox(),
      lastTrain.boundingBox(),
    ]);
    expect(railBox).not.toBeNull();
    expect(tabBox).not.toBeNull();

    expect(
      tabBox!.x + tabBox!.width,
      "Last train is not clipped by the tab rail",
    ).toBeLessThanOrEqual(railBox!.x + railBox!.width + 0.5);
    expect(tabBox!.height).toBeGreaterThanOrEqual(44);
    expect(tabBox!.width).toBeGreaterThanOrEqual(44);
    await expect(tablist).toHaveCSS("overflow-x", "auto");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
});
