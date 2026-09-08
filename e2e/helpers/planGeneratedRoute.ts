import { expect, type Locator, type Page } from "@playwright/test";

export async function generatePlanRoute(page: Page, action: Locator): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/plans/generate"
      && response.request().method() === "POST"),
    action.click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json() as { stops: Array<{ venueName: string }> };
  expect(body.stops.length).toBeGreaterThan(0);
  const inputs = page.getByRole("combobox", { name: "Venue name", exact: true });
  await expect(inputs).toHaveCount(body.stops.length);
  for (const [index, stop] of body.stops.entries()) {
    await expect(inputs.nth(index)).toHaveValue(stop.venueName);
  }
  await expect(page.getByRole("button", { name: "Sort it again", exact: true })).toBeEnabled();
}
