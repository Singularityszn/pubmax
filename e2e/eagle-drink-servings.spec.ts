import { expect, test } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [390, 1440]) {
  test(`${width}px: reviewed alcohol-free prices retain their stated servings and identities`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installDeterministicMapBasemap(page);
    const ratingRefs = new Set<string>();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname !== "/api/ratings" || url.searchParams.get("kind") !== "drink") return;
      for (const ref of (url.searchParams.get("refs") ?? "").split(",")) {
        if (ref.startsWith("drink-item-")) ratingRefs.add(ref);
      }
    });
    await page.goto("/map?sel=venue-1hz0avt");
    const menu = page.getByRole("tab", { name: "Menu", exact: true });
    await expect(async () => {
      await menu.click();
      await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    const panel = page.locator("#venuePanel-menu");
    const door = panel.locator('[data-menu-door="alcohol-free"]');
    await door.click();
    await expect(panel.locator(".drinkRow")).toHaveCount(12);
    await expect(panel.locator(".drinkLowNoChip")).toHaveCount(12);
    const identities = new Set<string>();
    for (const fact of [
      { name: "Steinbock, Riesling, Germany", serving: "125ml", price: "£7.10" },
      { name: "Steinbock, Riesling, Germany", serving: "750ml", price: "£35.50" },
      { name: "Nooh La Coste Rosé, Provence", serving: "125ml", price: "£8.90" },
      { name: "Nooh La Coste Rosé, Provence", serving: "750ml", price: "£46.50" },
    ]) {
      const row = panel.locator(".drinkRow")
        .filter({ has: page.getByText(fact.name, { exact: true }) })
        .filter({ has: page.getByText(fact.serving, { exact: true }) });
      await expect(row).toHaveCount(1);
      await expect(row.locator(".drinkPrice")).toHaveText(fact.price);
      await expect(row.locator(".drinkServing")).toHaveText(fact.serving);
      await expect(row.locator(".drinkProvChip")).toHaveAttribute("href", "https://www.theeaglew12.co.uk/wp-content/uploads/sites/61/2025/04/Eagle1612_cocktails1-1.pdf");
      await expect(row.locator("time")).toHaveText("13 Oct 2026");
      await expect(row.locator("time")).toHaveAttribute("datetime", "2026-10-13T10:19:25.911Z");
      if (width <= 640) {
        const rowWidth = (await row.boundingBox())!.width;
        const nameWidth = (await row.locator(".drinkName").boundingBox())!.width;
        expect(nameWidth).toBeGreaterThanOrEqual(rowWidth * 0.6);
      }
      identities.add((await row.locator(".drinkDisclosure").getAttribute("aria-controls"))!);
    }
    expect(identities.size).toBe(4);
    await expect.poll(() => ratingRefs.size).toBe(12);
    await expect(panel.locator(".drinkServing")).toHaveCount(4);
    await expect(panel.locator(".foodCalories")).toHaveCount(0);
    await expect(panel).not.toContainText(/0(?:\.0)?%/);
    await panel.getByRole("button", { name: "← Menus", exact: true }).click();
    await expect(door).toBeFocused();
  });
}
