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

test("rapid Social retries serialize full queues and a later retry refreshes rows", async ({ page }) => {
  let socialReads = 0;
  let reportedReads = 0;
  let hiddenReads = 0;
  let releaseFirstRetry = () => {};
  const firstRetryReady = new Promise<void>((resolve) => { releaseFirstRetry = resolve; });
  page.on("close", releaseFirstRetry);
  const drop = (note: string) => ({
    id: "11111111-1111-4111-8111-111111111111",
    venueId: "venue-11e0hkh",
    handle: "moderation_fixture",
    drink: "Lager",
    priceGbp: null,
    passedDownNote: note,
    era: "",
    status: "reported",
    pintPhotoUrl: null,
    venuePhotoUrl: null,
  });

  await page.route("**/api/admin/session", (route) => route.request().method() === "POST"
    ? route.fallback()
    : route.fulfill({ json: { authenticated: true } }));
  await page.route("**/api/admin/social-posts", (route) => {
    socialReads += 1;
    return route.fulfill({ status: 503, json: { error: "Queue temporarily unavailable" } });
  });
  await page.route("**/api/admin/community-prices", (route) => route.fulfill({ json: { prices: [] } }));
  await page.route("**/api/pint-drops?*", async (route) => {
    const reported = new URL(route.request().url()).searchParams.get("status") === "reported";
    const read = reported ? ++reportedReads : ++hiddenReads;
    if (read === 2) await firstRetryReady;
    await route.fulfill({ json: { drops: reported && read > 1
      ? [drop(read === 2 ? "First retry snapshot." : "Later retry snapshot.")]
      : [] } });
  });
  await page.route("**/api/admin/comments?*", (route) => route.fulfill({ json: { comments: [] } }));
  await page.route("**/api/visit-reports?*", (route) => route.fulfill({ json: { reports: [] } }));
  await page.route("**/api/venue-photos?*", (route) => route.fulfill({ json: { photos: [] } }));
  await page.route("**/api/admin/profile-avatars?*", (route) => route.fulfill({ json: { avatars: [], rotationCovers: [] } }));

  await page.goto("/admin");
  await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
  await page.getByRole("button", { name: "Open console" }).click();
  await expect(page.getByRole("tablist", { name: "Admin sections" })).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  await expect(async () => {
    // Repeat only a dropped hydration tap, never an already-started full load.
    if (socialReads === 0) await page.getByRole("button", { name: "Load reported drops" }).click();
    await expect(retry).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(retry).toBeEnabled();

  await retry.dblclick();
  await expect.poll(() => reportedReads).toBe(2);
  await expect.poll(() => hiddenReads).toBe(2);
  await expect(retry).toBeDisabled();
  await expect(page.getByRole("button", { name: "Loading…", exact: true })).toBeDisabled();
  releaseFirstRetry();
  await expect(page.getByText("First retry snapshot.", { exact: true })).toBeVisible();
  await expect(retry).toBeEnabled();
  expect(reportedReads).toBe(2);
  expect(hiddenReads).toBe(2);

  await retry.click();
  await expect(page.getByText("Later retry snapshot.", { exact: true })).toBeVisible();
  await expect(page.getByText("First retry snapshot.", { exact: true })).toHaveCount(0);
  await expect(retry).toBeEnabled();
  expect(reportedReads).toBe(3);
  expect(hiddenReads).toBe(3);
});
