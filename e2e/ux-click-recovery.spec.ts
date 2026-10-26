import { expect, test } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";

for (const [width, theme] of [[390, "light"], [390, "dark"], [1440, "light"], [1440, "dark"]] as const) {
  test(`${width}px ${theme}: a refused follow explains the wait and recovers without duplicate writes`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((value) => localStorage.setItem("pubmax-theme", value), theme);
    const auth = await installAuthDoubles(page);
    await page.route("**/api/profiles/uxfriend*", (route) => route.fulfill({ json: {
      profile: { id: "00000000-0000-4000-8000-000000000099", handle: "uxfriend", displayName: "UX Friend", visibility: "public" },
      projection: "full", counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false,
    } }));
    let writes = 0;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/profiles/uxfriend/follow", async (route) => {
      writes += 1;
      if (writes === 1) {
        await pending;
        await route.fulfill({ status: 429, headers: { "Retry-After": "2" }, json: {
          error: "Too Many Requests", code: "RATE_LIMITED", retryable: true,
        } });
      } else {
        await route.fulfill({ json: { following: true, counts: { followers: 1, following: 0 } } });
      }
    });
    await page.goto("/today");
    await auth.signedInAs("A");
    await page.goto("/u/uxfriend");
    const follow = page.locator(".profileFollow button");
    await expect(follow).toHaveText("Follow");
    await follow.click();
    try {
      await expect(follow).toHaveText("Adding…");
      await expect(follow).toBeDisabled();
    } finally {
      release();
    }
    await expect(page.locator(".followError")).toHaveText("Please wait a moment before trying again.");
    await expect(follow).toHaveAttribute("aria-pressed", "false");
    await expect(follow).toBeDisabled();
    expect(writes).toBe(1);
    await page.screenshot({ path: info.outputPath("follow-retry.png") });
    await expect(follow).toBeEnabled();
    await follow.click();
    await expect(follow).toHaveText("Following");
    await expect(follow).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".followError")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Followers: 1\./ })).toBeVisible();
    expect(writes).toBe(2);
    await page.screenshot({ path: info.outputPath("follow-recovered.png") });
  });
}

test("desktop Moment returns to the selected pub, including live map history", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/map?sel=venue-eltcmh");
  const share = page.getByRole("link", { name: "Share a Moment", exact: true });
  await expect(share).toBeVisible();
  // The map can change its URL without a React router render.
  await page.evaluate(() => history.replaceState(history.state, "", "/map?sel=venue-eltcmh&drink=wine"));
  await share.click();
  await expect(page).toHaveURL(/\/moment\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe("/map?sel=venue-eltcmh&drink=wine");
});

for (const start of ["/today", "/map"]) {
  test(`crawl command opens the builder from ${start}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(start);
    await expect(async () => {
      await page.getByRole("button", { name: "Open command palette" }).click();
      await expect(page.getByRole("combobox", { name: "Search commands" })).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await page.getByRole("combobox", { name: "Search commands" }).fill("Build a crawl on the map");
    await page.getByRole("option", { name: /Build a crawl on the map/ }).click();
    await expect(page).toHaveURL(/\/map\?.*plan=1/);
    await expect(page.locator(".mapDrawer.left")).toHaveClass(/open/);
    await expect(page.getByRole("button", { name: "Build your own", exact: true })).toHaveAttribute("aria-pressed", "true");
  });
}
