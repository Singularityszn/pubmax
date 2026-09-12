import { expect, test } from "@playwright/test";

// The consolidation moved the picker to /places and retired /choose-city. The
// old address answered a town nobody prices by reading the UK place index and
// offering the base map where that town is, so the picker owes the same answer
// or the move is a capability loss with a redirect on top.
//
// The walk is the whole path: the OLD address, the 308, and the arrival.
test("a town typed at the picker still opens its own arrival", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/choose-city?focus=search");
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/places");

  const field = page.locator(".placesSearchInput");
  const townList = page.locator(".placesTownList");

  // Didsbury is Manchester, and a place inside a city we ship keeps that city's
  // guide rather than being offered as an unpriced elsewhere.
  await expect(async () => {
    await field.fill("Didsbury");
    await expect(townList).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  const didsbury = townList.locator("a").first();
  await expect(didsbury).toHaveAttribute("href", "/map/manchester");
  await expect(didsbury).toContainText("Didsbury");

  // Sheffield is nobody's city pack, so it lands on the base map at its own
  // coordinates with the honest line about prices.
  await field.fill("Sheffield");
  const sheffield = townList.locator("a").first();
  await expect(sheffield).toHaveAttribute(
    "href",
    "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
  );
  await expect(sheffield).toContainText("No prices logged here yet");
});
