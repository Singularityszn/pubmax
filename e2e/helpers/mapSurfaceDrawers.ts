import { expect, type Page } from "@playwright/test";

export function desktopPlannerDrawer(page: Page) {
  return page.locator(".mapDrawer.left.springDrawer");
}

export function desktopVenueDrawer(page: Page) {
  return page.locator(".mapDrawer.right.springDrawer");
}

export async function expectSoleDesktopDrawer(
  page: Page,
  owner: "planner" | "venue",
  timeout = 60_000,
): Promise<void> {
  const planner = desktopPlannerDrawer(page);
  const venue = desktopVenueDrawer(page);
  await expect(async () => {
    await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1, {
      timeout: 2_000,
    });
    await expect(planner).toHaveAttribute(
      "aria-hidden",
      owner === "planner" ? "false" : "true",
      { timeout: 2_000 },
    );
    await expect(venue).toHaveAttribute(
      "aria-hidden",
      owner === "venue" ? "false" : "true",
      { timeout: 2_000 },
    );
  }).toPass({ timeout });
}
