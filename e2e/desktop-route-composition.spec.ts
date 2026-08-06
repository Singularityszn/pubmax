import { expect, test, type Locator } from "@playwright/test";

async function widthOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().width);
}

test.describe("desktop route composition", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("Tonight uses a wide primary column with a contextual rail", async ({ page }) => {
    await page.goto("/tonight");

    await expect(page.getByTestId("tonight-screen")).toBeVisible();
    expect(await widthOf(page.getByTestId("tonight-screen"))).toBeGreaterThan(1000);
    await expect(page.locator(".tonightContext")).toBeVisible();
    expect(await widthOf(page.locator(".tonightContext"))).toBeGreaterThanOrEqual(300);
  });

  test("Today presents its brief and pub context side by side", async ({ page }) => {
    await page.goto("/today");

    const screen = page.getByTestId("today-screen");
    await expect(screen).toBeVisible();
    expect(await widthOf(screen)).toBeGreaterThan(1000);

    const brief = page.locator(".todayBriefColumn");
    const explore = page.locator(".todayExploreColumn");
    await expect(brief).toBeVisible();
    await expect(explore).toBeVisible();
    const [briefBox, exploreBox] = await Promise.all([
      brief.boundingBox(),
      explore.boundingBox(),
    ]);
    expect(briefBox).not.toBeNull();
    expect(exploreBox).not.toBeNull();
    expect(exploreBox!.x).toBeGreaterThan(briefBox!.x + briefBox!.width);
  });
});

test.describe("phone route composition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Today keeps one card column in its original order", async ({ page }) => {
    await page.goto("/today");

    const cards = page.locator(".todayStack .todayCard");
    await expect(cards).toHaveCount(6);
    const boxes = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
    expect(boxes.every((box) => box.width < 390)).toBe(true);
    expect(boxes.every((box, index) => index === 0 || box.top > boxes[index - 1]!.top)).toBe(true);
  });
});
