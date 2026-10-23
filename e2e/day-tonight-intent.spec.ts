import { expect, test } from "@playwright/test";

// The switch must prepare only the destination the reader intends to open.
// Record route requests rather than relying on a fast local server's latency.
test("Day prepares Tonight on intent and preserves the current page until the click", async ({ page }) => {
  const tonightReads: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/tonight" &&
      request.headers()["next-router-prefetch"] === "1") {
      tonightReads.push(request.url());
    }
  });
  await page.goto("/today");
  const segment = page.getByRole("navigation", { name: "Now", exact: true });
  const tonight = segment.getByRole("link", { name: "Tonight", exact: true });
  await expect(segment.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(tonight).toBeVisible();
  expect(tonightReads).toEqual([]);

  await expect(async () => {
    await page.mouse.move(0, 0);
    await tonight.hover();
    expect(tonightReads.length).toBeGreaterThan(0);
  }).toPass({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/today$/);
  await expect(segment.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");

  await tonight.click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("navigation", { name: "Now", exact: true })
    .getByRole("link", { name: "Tonight", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Tonight prepares its desktop Map destination on intent before navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mapReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/map" && !url.searchParams.has("sel") &&
      request.headers()["next-router-prefetch"] === "1") {
      mapReads.push(request.url());
    }
  });
  await page.goto("/tonight");
  const navigation = page.getByRole("navigation", { name: "Site navigation", exact: true });
  const map = navigation.locator(".siteNavLinks").getByRole("link", { name: "Map", exact: true });
  await expect(map).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(mapReads).toEqual([]);

  await expect(async () => {
    await page.mouse.move(0, 0);
    await map.hover();
    expect(mapReads.length).toBeGreaterThan(0);
  }).toPass({ timeout: 5_000 });
  await expect(page).toHaveURL(/\/tonight$/);

  await map.click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByRole("navigation", { name: "Site navigation", exact: true })
    .getByRole("link", { name: "Map", exact: true })).toHaveAttribute("aria-current", "page");
});
