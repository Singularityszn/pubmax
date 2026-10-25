import { expect, test, type Locator, type Page } from "@playwright/test";

import { PERFORMANCE_BUDGETS } from "../lib/performanceBudgets";

const MOBILE = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not horizontally overflow at 390px").toBeLessThanOrEqual(1);
}

async function expectTappable(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => (await locator.boundingBox()) !== null, {
      message: `${label} should have a layout box`,
      timeout: 5_000,
    })
    .toBe(true);
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.height, `${label} should meet the 44px mobile tap target`).toBeGreaterThanOrEqual(44);
  expect(box.width, `${label} should be wide enough to tap`).toBeGreaterThanOrEqual(44);
}

async function expectVisibleTargetsTappable(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  for (let index = 0; index < Math.min(count, 6); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) {
      await expectTappable(item, `${label} ${index + 1}`);
    }
  }
}

test.describe("mobile Pubs gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("the performance readiness gate reaches the rendered gallery", async ({ page }) => {
    const route = PERFORMANCE_BUDGETS.routes.find((entry) => entry.path === "/pubs");
    expect(route, "the pub gallery has a performance budget").toBeDefined();
    if (!route) throw new Error("The pub gallery has no performance budget.");

    await page.goto(route.path, { waitUntil: "load" });
    const ready = page.locator(route.readySelector).first();
    await expect(ready).toBeVisible();
    await expect(
      ready.getByRole("heading", { level: 1, name: "Pub chains in London" }),
    ).toBeVisible();
    await expect(ready.locator(".pubsCard").first()).toBeVisible();
  });

  test("filters, cards, and card actions stay thumb-safe and navigable", async ({ page }) => {
    const errors = watchPageErrors(page);
    const response = await page.goto("/pubs");
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { level: 1, name: "Pub chains in London" }),
    ).toBeVisible();
    // The fare-zone squares carry a visible label, so they never read as pages.
    await expect(page.locator(".pubsZoneLabel")).toHaveText("Zone");
    // No card prints a drink word picked by hashing the venue id.
    await expect(page.locator(".pubsCardShelf, .pubsCardDrink, .pubsCardArtLabel")).toHaveCount(0);
    await expect(page.locator(".pubsCard").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const filters = page.locator(".pubsFilter");
    await expectVisibleTargetsTappable(filters, "pubs filter");
    await expect(filters.first()).toHaveAttribute("aria-pressed", "true");

    const secondFilter = filters.nth(1);
    if (await secondFilter.isVisible()) {
      await secondFilter.click();
      await expect(page).toHaveURL(/source=/);
      await expect(page.locator(".pubsFilter").nth(1)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.locator(".pubsCount")).toContainText(/pub/);
      await expectNoHorizontalOverflow(page);
    }

    const nextPage = page.getByRole("link", { name: "Next" });
    if (await nextPage.isVisible()) {
      await expectTappable(nextPage, "pubs next page link");
    }

    const firstCard = page.locator(".pubsCard").first();
    await expect(firstCard).toBeVisible();
    await expectTappable(firstCard.locator(".pubsMapLink"), "pub card map link");
    await expectVisibleTargetsTappable(firstCard.locator(".pubsMenuLink"), "pub card menu link");
    await expectVisibleTargetsTappable(firstCard.locator(".pubsBookLink"), "pub card booking link");
    await expectNoHorizontalOverflow(page);

    // THE CARD IS ONE DOOR: a tap on the pub's name, not on the button, still
    // lands on the map link stretched over the card, while the booking link
    // keeps its own target above the stretch.
    const mapLink = firstCard.locator(".pubsMapLink");
    await expect(mapLink).toHaveAttribute("href", /\/map\?sel=venue-/);
    const owner = async (selector: string): Promise<string | null> => {
      const box = await firstCard.locator(selector).boundingBox();
      if (!box) return null;
      return page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit?.closest("a")?.className ?? null;
        },
        { x: box.x + Math.min(10, box.width / 2), y: box.y + box.height / 2 },
      );
    };
    expect(await owner(".pubsCardName")).toContain("pubsMapLink");
    expect(await owner(".pubsBookLink")).toContain("pubsBookLink");
    // Tap the name's own point, as a thumb would. A locator click refuses on
    // purpose: the stretched map link covers the name, so Playwright reports
    // it as intercepted and retries until the test times out.
    await firstCard.locator(".pubsCardName").scrollIntoViewIfNeeded();
    const nameBox = await firstCard.locator(".pubsCardName").boundingBox();
    expect(nameBox, "the pub name has a box to tap").not.toBeNull();
    await page.mouse.click(nameBox!.x + Math.min(10, nameBox!.width / 2), nameBox!.y + nameBox!.height / 2);
    await expect(page).toHaveURL(/\/map\?sel=venue-/, { timeout: 30_000 });
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });

    expect(errors).toEqual([]);
  });
});
