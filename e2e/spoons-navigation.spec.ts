import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1440]) {
  test(`${width}px Spoons navigation opens searchable recorded costs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/privacy");

    const nav = page.getByRole("navigation", { name: width <= 640 ? "Primary" : "Site navigation" });
    const spoons = nav.getByRole("link", { name: "Spoons", exact: true });
    await expect(spoons).toBeVisible();
    const box = (await spoons.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect(async () => {
      await spoons.click();
      await expect(page.getByRole("searchbox", { name: "Find a Spoons" })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/spoons-value$/);
    await expect(nav.getByRole("link", { name: "Spoons", exact: true })).toHaveAttribute("aria-current", "page");

    const search = page.getByRole("searchbox", { name: "Find a Spoons" });
    await search.fill("Teignmouth");
    const rows = page.locator(".spoonsTable tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("The Jolie Brise");
    await expect(rows.first()).toContainText("£9.96");
    await rows.first().locator("summary").click();
    await expect(rows.first()).toContainText("£8.97 total");
    await expect(rows.first()).toContainText("£0.99 total");
    await expect(rows.first()).toContainText("Source read 2026-08-30");
    await page.screenshot({ path: testInfo.outputPath(`spoons-costs-${width}.png`) });

    await search.fill("no-such-pub-for-this-search");
    await expect(page.getByText("No pubs match this search.")).toBeVisible();
    await page.getByRole("button", { name: "Show all pubs" }).click();
    await expect(rows).toHaveCount(805);
    await expect(search).toHaveValue("");
    await page.mouse.move(width / 2, 450);
    await page.mouse.wheel(0, 600);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
    expect(errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`${width}px Drink exposes Lucia and opens the existing price list`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map?drink=soft-drink");
    const open = width <= 640
      ? page.getByRole("button", { name: /Drink shown on the map/ })
      : page.locator(".mapToolbarDrinkLaneBtn").first();
    const lucia = page.getByRole("link", { name: /Lucia 🐐/ });
    await expect(async () => {
      await open.click();
      await expect(lucia).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    if (width <= 640) {
      await expect(page.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
    }
    await page.screenshot({ path: testInfo.outputPath(`lucia-drink-${width}.png`) });
    await lucia.click();
    await expect(page).toHaveURL(/\/soft-drinks-and-water\?sub=soft-drink-lucia-special$/);
    await expect(page.getByRole("tab", { name: "Lucia 🐐", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Open the map", exact: true })).toHaveAttribute(
      "href", "/map?drink=soft-drink&sub=soft-drink-lucia-special",
    );
  });
}
