import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

test("a failed ranking read keeps keyboard focus on its retry action", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await storeThemeChoice(page, "light");
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.route("**/api/social/rankings**", (route) => route.fulfill({
    status: 503,
    json: { code: "RANKING_UNAVAILABLE", error: { message: "Your ranking is unavailable right now." }, retryable: true },
  }));
  await page.goto("/pubs/venue-e1srzr");
  await expect(page.getByRole("button", { name: "Account options for Karan" })).toBeVisible();
  const action = page.getByRole("button", { name: /^(Rank it|Try ranking again)$/ });
  await action.focus();
  await action.click();
  await expect(page.locator(".pubPage__actions").getByRole("status")).toContainText("unavailable");
  await expect(action).toBeFocused();
});
