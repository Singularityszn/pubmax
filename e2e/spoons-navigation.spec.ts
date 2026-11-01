import { expect, test } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";

// Captain, 1 Nov 2026: phones keep the six-button dock (five destinations and
// the Pub Pal's door); Spoons is a desktop door only. On a phone the ranking is
// reached from the Drink sheet, and Lucia sits under soft drinks on both.
for (const width of [320, 390]) {
  test(`${width}px phone dock keeps six buttons and no Spoons tab`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/privacy");
    const nav = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(nav).toBeVisible();
    const links = nav.getByRole("link");
    await expect(links).toHaveCount(6);
    await expect(links).toHaveText(["Map", "Tonight", "Pal", "Plan", "Social", "You"]);
    await expect(nav.getByRole("link", { name: "Spoons", exact: true })).toHaveCount(0);
  });
}

for (const width of [641, 768, 900, 1440]) {
  test(`${width}px desktop Spoons navigation opens searchable recorded costs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/privacy");

    const nav = page.getByRole("navigation", { name: "Site navigation" });
    const spoons = nav.getByRole("link", { name: "Spoons", exact: true });
    await expect(spoons).toBeVisible();
    const covered = await nav.locator(".siteNavLink").evaluateAll((links) =>
      links.filter((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !hit || !link.contains(hit);
      }).map((link) => link.textContent),
    );
    expect(covered).toEqual([]);
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

for (const width of [641, 768, 900]) {
  test(`${width}px signed-in navigation keeps every destination reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    await page.goto("/spoons-value");
    await expect(page.locator(".siteNavLinks .siteNavLink")).toHaveCount(6);
    const actions = page.locator(".siteNavActions");
    await expect(actions.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Activity", exact: true })).toHaveAttribute("href", "/activity");
    await expect(actions.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
    await expect(actions.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute("href", "/messages");
    const blocked = await page.locator(".siteNavLinks .siteNavLink, .siteNavActions .siteNavBell").evaluateAll((links) =>
      links.filter((link) => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !hit || !link.contains(hit) || link.scrollWidth > link.clientWidth + 1;
      }).map((link) => link.textContent),
    );
    expect(blocked).toEqual([]);
  });
}

test.describe("short phone Drink sheet", () => {
  test.use({ isMobile: true, hasTouch: true });
  test("touch scrolling reaches lower content without moving the map shell", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/map?drink=soft-drink");
    await expectMobileMapShellReady(page);
    const open = await mobileMapShellControl(page, "drink");
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
    await expect(async () => {
      await open.click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await sheet.getByRole("button", { name: "Spoons value", exact: true }).click();
    await expect(sheet.locator(".spoonsValueLensLegend")).toBeVisible();
    const body = sheet.locator(".mobileSharedSheetBody");
    await expect.poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
    const box = (await body.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width / 2;
    const start = box.y + box.height * 0.8;
    const travel = box.height * 0.6;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: start - travel * step / 12 }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("drink-touch-scroll-320.png") });
    await cdp.detach();
  });
});

for (const width of [390, 1440]) {
  test(`${width}px Drink exposes Lucia under soft drinks and opens the existing price list`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/map?drink=soft-drink");
    if (width <= 640) await expectMobileMapShellReady(page);
    const open = width <= 640
      ? await mobileMapShellControl(page, "drink")
      : page.locator(".mapToolbarDrinkLaneBtn").first();
    const lucia = page.getByRole("link", { name: /Lucia 🐐/ });
    await expect(async () => {
      await open.click();
      await expect(lucia).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    if (width <= 640) {
      await expect(page.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
    }
    await expect(lucia.locator(".drinkLanePickerLuciaLane")).toHaveText("Soft drinks");
    await page.screenshot({ path: testInfo.outputPath(`lucia-drink-${width}.png`) });
    await lucia.click();
    await expect(page).toHaveURL(/\/soft-drinks-and-water\?sub=soft-drink-lucia-special$/);
    await expect(page.getByRole("tab", { name: "Lucia 🐐", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Open the map", exact: true })).toHaveAttribute(
      "href", "/map?drink=soft-drink&sub=soft-drink-lucia-special",
    );
  });
}
