import { expect, test, type Page } from "@playwright/test";

/**
 * The removal shelf in the Night Memory studio (D06).
 *
 * The contribution battle test of 5 September 2026 found the studio could
 * create a Memory and a Moment and remove neither. The shelf is the control,
 * and Remove is two beats: it arms an inline confirm, and only the confirm
 * beside it spends the DELETE.
 *
 * Auth is the mocked session the other signed-in browser specs use, so this
 * runs keyless; the reads and the two DELETE routes are answered here.
 */
const VIEWPORT = { width: 390, height: 844 };
const AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const MEMORY_ID = "11111111-2222-4333-8444-555555555555";

type Deleted = { memories: string[]; moments: string[] };

async function installStudio(page: Page): Promise<Deleted> {
  const deleted: Deleted = { memories: [], moments: [] };
  await page.addInitScript(({ key, userId }) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem(key, JSON.stringify({
      access_token: "pubmaxx-e2e-access-token",
      refresh_token: "pubmaxx-e2e-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 86_400,
      expires_in: 86_400,
      token_type: "bearer",
      user: {
        id: userId,
        aud: "authenticated",
        role: "authenticated",
        email: "memory-e2e@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-07-29T00:00:00.000Z",
      },
    }));
  }, { key: AUTH_STORAGE_KEY, userId: USER_ID });

  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ id: USER_ID, aud: "authenticated", role: "authenticated", email: "memory-e2e@example.test" }),
  }));
  await page.route("**/api/identity/onboarding", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ complete: true, handle: "night_owl" }),
  }));
  await page.route("**/api/identity/handle/current", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ handle: "night_owl" }),
  }));
  await page.route("**/api/night-stories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ stories: [] }),
  }));
  await page.route("**/api/night-memories", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ memories: [{ id: MEMORY_ID, title: "Friday orbit", createdAt: "2026-09-04T21:10:00.000Z" }] }),
  }));
  await page.route("**/api/night-memories/*/moments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ moments: [
      { id: "moment-photo", kind: "photo", caption: "The crew at the first stop", venueId: null, createdAt: "2026-09-04T21:30:00.000Z" },
      { id: "moment-quote", kind: "quote", caption: "One more detour and then home", venueId: null, createdAt: "2026-09-04T22:05:00.000Z" },
    ] }),
  }));
  await page.route("**/api/night-moments/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleted.moments.push(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ removed: true }) });
  });
  await page.route(`**/api/night-memories/${MEMORY_ID}`, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleted.memories.push(MEMORY_ID);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ removed: true }) });
  });
  return deleted;
}

test.use({ viewport: VIEWPORT });
test.setTimeout(60_000);

test("a Moment is removed on the second beat, and the studio keeps its width", async ({ page }) => {
  const deleted = await installStudio(page);
  const response = await page.goto("/u/you#night-memories");
  expect(response?.status()).toBe(200);

  const shelf = page.locator(".memoryKeepShelf");
  await expect(shelf).toBeVisible({ timeout: 30_000 });
  const momentRow = shelf.locator(".memoryKeepList--moments li").first();
  await expect(momentRow).toContainText("The crew at the first stop");

  // A row's title is one nowrap line, so the shelf is where a phone would lose
  // its width if any box around it floored on its content.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(VIEWPORT.width);

  // First beat: arm, and nothing is sent.
  await momentRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(momentRow.getByText("Remove this Moment, and its photo with it?")).toBeVisible();
  expect(deleted.moments).toEqual([]);

  // Keep it puts the row back as it was.
  await momentRow.getByRole("button", { name: "Keep it" }).click();
  await expect(momentRow.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  expect(deleted.moments).toEqual([]);

  // Second beat: the confirm is the only thing that spends the request.
  await momentRow.getByRole("button", { name: "Remove", exact: true }).click();
  await momentRow.getByRole("button", { name: "Remove for good" }).click();
  await expect(page.getByText("Moment removed. Its photo went with it.")).toBeVisible();
  expect(deleted.moments).toEqual(["moment-photo"]);
  await expect(shelf.locator(".memoryKeepList--moments li")).toHaveCount(1);
});

test("a Memory is removed with the Moments inside it", async ({ page }) => {
  const deleted = await installStudio(page);
  await page.goto("/u/you#night-memories");

  const shelf = page.locator(".memoryKeepShelf");
  await expect(shelf).toBeVisible({ timeout: 30_000 });
  const memoryRow = shelf.locator(".memoryKeepList > li").first();
  await expect(memoryRow).toContainText("Friday orbit");

  await memoryRow.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(memoryRow.getByText("Remove this Memory and every Moment in it?")).toBeVisible();
  expect(deleted.memories).toEqual([]);

  await memoryRow.getByRole("button", { name: "Remove for good" }).click();
  await expect(
    page.getByText("Memory removed. Its Moments and their photos went with it."),
  ).toBeVisible();
  expect(deleted.memories).toEqual([MEMORY_ID]);
  await expect(shelf).toHaveCount(0);
});
