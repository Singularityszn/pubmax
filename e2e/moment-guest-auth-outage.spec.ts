import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", storageState: { cookies: [], origins: [] } });

test("a guest can edit a local photo when the authentication client cannot download", async ({ page }, testInfo) => {
  const blocked: string[] = [];
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/night-memories")) writes.push(new URL(request.url()).pathname);
  });
  // Fail the real lazy SDK download, while serving the rest of the production
  // assets unchanged. The UI and editor run normally without replacing Auth
  // context, React state, IndexedDB, or the photo editor.
  await page.route((url) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js"), async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("AuthRetryableFetchError")) {
      blocked.push(new URL(route.request().url()).pathname);
      await route.abort("failed");
      return;
    }
    await route.fulfill({ response });
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await page.goto("/moment");
  await expect.poll(() => blocked.length).toBeGreaterThan(0);
  const caption = page.getByPlaceholder("One line you will still remember next year.");
  await expect(caption).toBeVisible();
  await caption.fill("A local guest night while authentication is unavailable.");
  await page.locator('input[type="file"]').setInputFiles(resolve(process.cwd(), "e2e/fixtures/bill.jpg"));
  const edit = page.getByRole("button", { name: "Edit bill.jpg", exact: true });
  await expect(edit).toBeVisible();
  await expect(async () => {
    await edit.click();
    await expect(page.getByRole("dialog", { name: "Edit photo" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(page.getByRole("group", { name: "Filter", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use photo", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit photo" })).toHaveCount(0);
  await expect(page.getByText("Edited photo ready.", { exact: true })).toBeVisible();
  await expect(caption).toHaveValue("A local guest night while authentication is unavailable.");
  expect(writes).toEqual([]);
  await testInfo.attach("guest-auth-download-failure", { body: JSON.stringify({ blocked, writes }), contentType: "application/json" });
  await testInfo.attach("guest-edited-local-photo", { body: await page.screenshot(), contentType: "image/png" });
});
