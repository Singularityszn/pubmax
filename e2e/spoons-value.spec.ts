import { expect, test, type Page } from "@playwright/test";

// The Spoons value lane, end to end: the ranking page a stranger opens, and the
// lens a reader switches on over the map.
//
// The lens is OFF by default and its lane is fetched by nothing until somebody
// asks for it, which is the whole of the bound this feature was built under. So
// the first assertion here is a NEGATIVE one: a cold /map must not ask.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.describe("the ranking a stranger opens", () => {
  test("ranks pubs by what a tenner buys, and every figure carries its round", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.goto("/spoons-value");

    await expect(
      page.getByRole("heading", { name: "What a tenner buys in a Wetherspoon" }),
    ).toBeVisible();

    const firstRow = page.locator(".spoonsTable tbody tr").first();
    await expect(firstRow).toBeVisible();
    // A figure never prints bare: it carries its unit, and the round it came
    // from is in the same row.
    await expect(firstRow.locator(".spoonsTableUnitsFigure")).toContainText("units");
    await expect(firstRow.locator(".spoonsTableRound")).toContainText("£");

    // Credited and linked wherever a figure is printed.
    await expect(page.getByRole("link", { name: /SpoonMe/ }).first()).toBeVisible();
    await expect(page.getByText("This ranks what a tenner buys, not what to drink.")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("narrows without re-ranking, so a rank keeps its meaning", async ({ page }) => {
    await page.goto("/spoons-value");
    await expect(page.locator(".spoonsTable tbody tr").first()).toBeVisible();

    const everywhere = await page.locator(".spoonsTable tbody tr").count();
    const airports = page.getByRole("button", { name: /^Airports/ });
    await expect(airports).toBeVisible();
    await airports.click();

    const narrowed = page.locator(".spoonsTable tbody tr");
    await expect.poll(() => narrowed.count()).toBeLessThan(everywhere);
    // A narrowed list still shows national ranks, so the numbers do not restart.
    const ranks = await narrowed.locator(".spoonsTableRank").allInnerTexts();
    expect(ranks.length).toBeGreaterThan(0);
    expect(Number(ranks[0])).toBeGreaterThan(1);
  });

  test("scrolls its table inside its own box, never the page sideways", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/spoons-value");
    await expect(page.locator(".spoonsTable tbody tr").first()).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

test.describe("the lens over the map", () => {
  test("asks for nothing until a reader switches it on", async ({ page }) => {
    const laneReads: string[] = [];
    await page.route("**/data/spoonme/**", (route) => {
      laneReads.push(route.request().url());
      return route.continue();
    });

    await page.goto("/map");
    await page.waitForTimeout(4000);
    // A cold map pays nothing for a lens nobody has asked for.
    expect(laneReads).toEqual([]);

    // A server-painted control is tappable before React attaches, so the tap
    // is retried rather than the assertion after it hardened (the house idiom).
    const lanePanel = page.locator(".mapToolbarDrinkLaneBtn").first();
    const toggleProbe = page.locator(".spoonsValueLensToggle").first();
    await expect(async () => {
      await lanePanel.click();
      await expect(toggleProbe).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });

    const toggle = page.locator(".spoonsValueLensToggle").first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // The legend prints the number each band was cut at, not only the colours.
    const legend = page.locator(".spoonsValueLensLegend");
    await expect(legend).toBeVisible();
    await expect(legend).toContainText("More than most");
    await expect(legend).toContainText("The usual round");
    await expect(legend).toContainText("Less than most");
    // The legend prints the threshold DERIVED from the lane's own rows, so it
    // can only be on screen once that lane has been read. The recorder above is
    // not asked to confirm the read: a service worker serves this file on a
    // production build and page.route() never sees a request it answers, which
    // is exactly why the negative assertion is taken BEFORE the worker can have
    // cached anything.
    await expect(legend).toContainText("12.8");
  });
});
