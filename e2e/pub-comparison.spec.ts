import { expect, test } from "@playwright/test";
import { comparisonDrinkKey, type PubComparisonRequest, type PubComparisonResponse } from "../lib/pubComparison";

const drink = { category: "beer" as const, drinkLabel: "Guinness", serving: "pint" };
const choices = [
  { id: "venue-test-a", name: "The Crown", area: "Islington", address: "1 Test Street" },
  { id: "venue-test-b", name: "The Crown", area: "Camden", address: "2 Test Street" },
];

for (const width of [390, 1440]) {
  test(`comparison keeps exact servings, branches and private choices at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/venue-search?*", (route) => route.fulfill({ json: { status: "ready", venues: choices } }));
    await page.route("**/api/pub-comparison*", async (route) => {
      if (route.request().method() === "GET") {
        const ids = new URL(route.request().url()).searchParams.get("venues")?.split(",") ?? [];
        await route.fulfill({ json: { status: "ready", venues: choices.filter((pub) => ids.includes(pub.id)).map((pub) => ({ ...pub, borough: pub.area })),
          drinks: ids.length ? [{ ...drink, key: comparisonDrinkKey(drink) }] : [], coverage: "ready", meetingPoints: [{ id: "big-ben", name: "Big Ben" }] } });
        return;
      }
      const input = route.request().postDataJSON() as PubComparisonRequest;
      const output: PubComparisonResponse = { status: "ready", completeVenueCount: 1, meetingPoint: { id: "big-ben", name: "Big Ben" },
        venues: choices.map((pub, index) => ({
          id: pub.id, name: pub.name, address: pub.address, borough: pub.area, knownSubtotalPence: index ? 0 : 1000,
          totalPence: index ? null : 1000, mapHref: `/map?sel=${pub.id}`,
          walk: { status: "unavailable", minutes: null, method: null, timing: null },
          items: input.order.map((requested) => ({ requested, status: index ? "missing" : "matched", reason: index ? "Serving size is not recorded." : null,
            lineTotalPence: index ? null : 1000, evidence: index ? null : { ...drink, pricePence: 500, serving: "pint", sourceClass: "listed",
              sourceKind: "directory", sourceUrl: "https://example.org/test-menu", publisher: "Test pub", date: "2026-10-01", dateMeaning: "source-read", eligible: true } })),
        })) };
      await route.fulfill({ json: output });
    });
    await page.goto("/tools");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Same order. Which pub?");
    for (const pub of choices) {
      // The field is painted on the server, so a fill before hydration is lost.
      // Retry the action, as e2e/AGENTS.md describes.
      await expect(async () => {
        await page.getByLabel("Pub name", { exact: true }).fill("Crown");
        await page.getByRole("button", { name: `Add ${pub.name}, ${pub.area}`, exact: true }).click({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
    }
    await page.getByLabel("Drink and serving", { exact: true }).selectOption(comparisonDrinkKey(drink));
    await page.getByLabel("Number in your order", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Add to order", exact: true }).click();
    await page.getByLabel("Public meeting point, optional").selectOption("big-ben");
    await page.getByRole("button", { name: "Compare these pubs", exact: true }).click();
    await expect(page.getByText("Listed order total £10.00", { exact: true })).toBeVisible();
    await expect(page.getByText("Known subtotal £0.00. Order incomplete.", { exact: true })).toBeVisible();
    await expect(page.getByText("Serving size is not recorded.", { exact: true })).toBeVisible();
    await expect(page.locator(".pubComparisonResults")).not.toContainText("Compared with");
    const shared = page.getByRole("textbox", { name: "Pub links to share" });
    await expect(shared).not.toHaveValue(/Big Ben|Guinness|£/);
    await expect(page.getByRole("link", { name: "Open this pub to plan: The Crown, 1 Test Street", exact: true })).toHaveAttribute("href", "/map?sel=venue-test-a");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Remove Guinness, pint", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Your order, pub by pub", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/\/tools$/);
  });
}
