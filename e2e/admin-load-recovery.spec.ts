import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";

test("session recovery during a full queue load releases the load control", async ({ page }, testInfo) => {
  let sessionOpen = true;
  let socialReads = 0;
  let releaseDrops = () => {};
  const dropsReady = new Promise<void>((resolve) => { releaseDrops = resolve; });

  await page.route("**/api/admin/session", async (route) => {
    if (route.request().method() === "POST") {
      sessionOpen = true;
      await route.fallback();
      return;
    }
    await route.fulfill({ json: { authenticated: sessionOpen } });
  });
  await page.route("**/api/admin/social-posts", async (route) => {
    socialReads += 1;
    if (socialReads === 1) {
      sessionOpen = false;
      await route.fulfill({ status: 403, json: { error: "Session expired" } });
      return;
    }
    await route.fulfill({ json: { posts: [] } });
  });
  await page.route("**/api/admin/community-prices", (route) => route.fulfill({ json: { prices: [] } }));
  await page.route("**/api/pint-drops?*", async (route) => {
    await dropsReady;
    await route.fulfill({ json: { drops: [] } });
  });
  await page.route("**/api/admin/comments?*", (route) => route.fulfill({ json: { comments: [] } }));
  await page.route("**/api/visit-reports?*", (route) => route.fulfill({ json: { reports: [] } }));
  await page.route("**/api/venue-photos?*", (route) => route.fulfill({ json: { photos: [] } }));
  await page.route("**/api/admin/profile-avatars?*", (route) => route.fulfill({ json: { avatars: [], rotationCovers: [] } }));

  await page.goto("/admin");
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(page.getByRole("tablist", { name: "Admin sections" })).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "Load reported drops" }).click();
    await expect(page.getByLabel("Admin token")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Loading…", exact: true })).toBeDisabled();

  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Resume moderation" }).click();
  await expect(page.getByText("No Social posts awaiting review")).toBeVisible();
  const finalQueue = page.waitForResponse((response) => response.url().includes("/api/admin/profile-avatars"));
  releaseDrops();
  await finalQueue;
  await expect(page.getByRole("button", { name: "Load reported drops" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("recovered-admin-load.png") });
  expect(socialReads).toBe(2);
  const refreshedSocial = page.waitForResponse((response) => response.url().endsWith("/api/admin/social-posts"));
  await page.getByRole("button", { name: "Load reported drops" }).click();
  await refreshedSocial;
  await expect(page.getByRole("button", { name: "Load reported drops" })).toBeEnabled();
  expect(socialReads).toBe(3);
});
