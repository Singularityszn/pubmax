import { expect, test } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const cases = [
  { question: "Price and published calories for Mixed Olives at The New Inn", item: "Mixed Olives", price: "£5.00", venueId: "venue-17qpap6", note: "163 kcal", source: "https://www.newinnealing.com/food-and-drink" },
  { question: "Price of 125ml Steinbock Riesling at The Eagle, Hammersmith and Fulham", item: "Steinbock, Riesling, Germany", price: "£7.10", venueId: "venue-1hz0avt", note: "Published serving: 125ml", source: "https://www.theeaglew12.co.uk/wp-content/uploads/sites/61/2025/04/Eagle1612_cocktails1-1.pdf" },
  { question: "Price of Organic Pinot Grigio at Sherlock Holmes", item: "Organic Pinot Grigio, Riff, Italy", price: "£7.20", venueId: "venue-gk2fp9", note: "Serving size not recorded", source: "https://www.greeneking.co.uk/pubs/greater-london/sherlock-holmes/menu" },
  { question: "Vegan vegetarian Mixed Olives price at The New Inn", item: "Mixed Olives", price: "£5.00", venueId: "venue-17qpap6", note: "163 kcal", source: "https://www.newinnealing.com/food-and-drink" },
  { question: "Is Classic sausage roll vegan at The New Inn?", item: "Classic sausage roll", price: "£5.50", venueId: "venue-17qpap6", note: "Dietary labels not recorded", source: "https://www.newinnealing.com/food-and-drink" },
  { question: "Price of 8oz Bavette steak at The New Inn", item: "8oz Bavette steak", price: "£23.00", venueId: "venue-17qpap6", note: "1394 kcal", source: "https://www.newinnealing.com/food-and-drink", foodCalories: 1394, observed: "2026-10-13" },
  { question: "Price of 10oz West Country Ribeye Steak at The Eagle, Hammersmith and Fulham", item: "10oz West Country Ribeye Steak", price: "£44.00", venueId: "venue-1hz0avt", note: "776 kcal", source: "https://www.theeaglew12.co.uk/food-drink", foodCalories: 776, observed: "2026-10-13" },
];

for (const width of [390, 1440]) {
  for (const scenario of cases) {
    test(`${width}px: Pal shows accepted ${scenario.item} evidence for ${scenario.question}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await installDeterministicMapBasemap(page);
      await page.goto("/pal/chat");
      const composer = page.getByRole("textbox", { name: "Describe the outing", exact: true });
      await composer.fill(scenario.question);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/pub-pal/chat") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const card = page.locator(".palChatCard").filter({ hasText: scenario.item });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(scenario.price);
      await expect(card).toContainText(scenario.note);
      if (scenario.item === "Steinbock, Riesling, Germany" || scenario.item === "Organic Pinot Grigio, Riff, Italy") {
        await expect(card).toContainText("Published calories not recorded.");
        await expect(card).toContainText("Dietary labels not recorded.");
      }
      if (scenario.foodCalories !== undefined) {
        await expect(card).toContainText("Serving size not recorded.");
        await expect(card).toContainText("Dietary labels not recorded.");
        await expect(card).toContainText(`Price observed ${scenario.observed}.`);
      }
      await expect(card).toContainText("Availability unknown");
      await expect(card.locator(`a[href="${scenario.source}"]`)).toBeVisible();
      if (scenario.item === "Mixed Olives") await expect(card).toContainText("vegan, vegetarian");
      if (scenario.venueId === "venue-17qpap6") await expect(card).toContainText("2026-10-13");
      await card.scrollIntoViewIfNeeded();
      const fit = await card.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth, document: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(fit.content).toBeLessThanOrEqual(fit.width + 1);
      expect(fit.document).toBeLessThanOrEqual(fit.viewport);
      const mapLink = card.locator(`a[href="/map?sel=${scenario.venueId}"]`);
      await expect(mapLink).toBeVisible();
      await mapLink.click();
      await expect(page).toHaveURL(new RegExp(`/map\\?sel=${scenario.venueId}$`));
      await expect(page.getByRole("tab", { name: "Menu", exact: true })).toBeVisible({ timeout: 45_000 });
      if (scenario.foodCalories !== undefined) {
        const menu = page.getByRole("tab", { name: "Menu", exact: true });
        await expect(async () => {
          await menu.click();
          await expect(menu).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        const panel = page.locator("#venuePanel-menu");
        const food = panel.locator('[data-menu-door="food"]');
        await food.click();
        const back = panel.getByRole("button", { name: "Back to menus", exact: true });
        await expect(back).toBeFocused();
        const row = panel.locator(".drinkRow").filter({ has: page.getByText(scenario.item, { exact: true }) });
        await expect(row).toHaveCount(1);
        await expect(row.locator(".drinkPrice")).toHaveText(scenario.price);
        await expect(row.locator(".foodCalories")).toContainText(`${scenario.foodCalories} kcal on the menu`);
        await expect(row.locator(`a[href="${scenario.source}"]`)).toBeVisible();
        await expect(row.locator("time")).toHaveAttribute("datetime", new RegExp(`^${scenario.observed}T`));
        await back.click();
        await expect(food).toBeFocused();
      }
    });
  }
  for (const question of [
    "Vegan gluten-free options at The New Inn",
    "Gluten free vegan options at The New Inn",
    "Vegan sausage roll price at The New Inn",
    "Vegan gluten-free Mixed Olives price at The New Inn",
  ]) {
    test(`${width}px: Pal refuses unrecorded dietary conditions: ${question}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto("/pal/chat");
      await page.getByRole("textbox", { name: "Describe the outing", exact: true }).fill(question);
      const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/pub-pal/chat") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Ask", exact: true }).click();
      const response = await responsePromise;
      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.cards).toEqual([]);
      expect(body.answer).toBe("No accepted menu item matches that request at The New Inn. Availability is unknown.");
      await expect(page.getByText(body.answer, { exact: true })).toBeVisible();
      await expect(page.locator(".palChatCard")).toHaveCount(0);
    });
  }
}
