import { expect, test, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  accessJwt,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
  seedSignedIn,
} from "./helpers/authDoubles";
import { MOBILE_MAP_SESSION_KEY } from "@/lib/mobileShell";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady } from "./helpers/mobileMapShell";

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

// This fixture uses the app's own persisted session shape. It is written only
// after leaving the map, so a stale saved Pints session competes with the
// explicit Wine return URL rather than changing the visible map first.
async function prepareWineMap(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  // The phone Create action is hidden while a pub detail sheet is selected.
  // Start the phone case without a pub. Desktop still proves selected-pub return.
  await page.goto(width === 390 ? "/map" : "/map?sel=venue-eltcmh");
  await expectMapLoadingFrameReleased(page);
  if (width === 390) {
    await expectMobileMapShellReady(page);
    const drink = page.getByRole("button", { name: /^Drink shown on the map:/ });
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
    await expect(async () => {
      await drink.click();
      await expect(sheet).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await sheet.getByRole("button", { name: "Wine", exact: true }).click();
    await expect(drink).toContainText("Wine");
    // Browser Back closes the drink picker through its existing history owner.
    await page.goBack();
    await expect(sheet).toHaveCount(0);
  } else {
    await expect(async () => {
      await page.getByRole("button", { name: "Drink: Pints", exact: true }).click();
      await expect(page.getByRole("group", { name: "Drink prices shown on the map", exact: true })).toBeVisible({ timeout: 1_000 });
    }).toPass();
    const wine = page.getByRole("group", { name: "Drink prices shown on the map", exact: true })
      .getByRole("button", { name: "Wine", exact: true });
    await wine.click();
    await expect(wine).toHaveAttribute("aria-pressed", "true");
  }
  await expect.poll(() => new URL(page.url()).searchParams.get("drink")).toBe("wine");
  if (width === 390) expect(new URL(page.url()).searchParams.has("sel")).toBe(false);
  else expect(new URL(page.url()).searchParams.get("sel")).toBe("venue-eltcmh");
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), MOBILE_MAP_SESSION_KEY)).not.toBeNull();
}

async function returnFromMoment(page: Page, width: number, returnTo: string): Promise<void> {
  await expect(page).toHaveURL(/\/moment\?/);
  expect(new URL(page.url()).searchParams.get("returnTo")).toBe(returnTo);
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key)!);
    saved.filters.drinkCategory = "";
    saved.filters.query = "Hatton";
    saved.filters.maxPrice = 6;
    localStorage.setItem(key, JSON.stringify(saved));
  }, MOBILE_MAP_SESSION_KEY);
  // Use the product's Back link, not a new goto or a fixture navigation.
  const back = page.getByRole("link", { name: "Back", exact: true });
  await expect(async () => {
    await back.click();
    await expect(page).toHaveURL((url) => url.pathname + url.search === returnTo, { timeout: 1_000 });
  }).toPass();
  if (width === 390) {
    await expectMobileMapShellReady(page);
    await expect(page.getByRole("button", { name: /^Drink shown on the map:/ })).toContainText("Wine");
  } else {
    await expect(page.getByRole("button", { name: "Drink: Wine", exact: true })).toBeVisible();
  }
  expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
  if (width === 390) {
    // This bounded phone case returns to the unselected map it actually left.
    expect(new URL(page.url()).searchParams.has("sel")).toBe(false);
  } else {
    expect(new URL(page.url()).searchParams.get("sel")).toBe("venue-eltcmh");
    await expect(page.getByRole("heading", { name: "The Blackfriar", exact: true }).first()).toBeVisible();
  }
}

test.describe("Wine Moment return", () => {
  test.use({ serviceWorkers: "block" });

  test("desktop Moment returns to Wine and the selected pub despite saved Pints", async ({ page }) => {
    await prepareWineMap(page, 1440);
    const returnTo = new URL(page.url()).pathname + new URL(page.url()).search;
    const share = page.getByRole("link", { name: "Share a Moment", exact: true });
    await expect(share).toBeVisible();
    await share.click();
    await returnFromMoment(page, 1440, returnTo);
  });

  test("390px Create Moment returns to an unselected Wine map despite saved Pints", async ({ page }) => {
    await prepareWineMap(page, 390);
    const returnTo = new URL(page.url()).pathname + new URL(page.url()).search;
    expect(new URL(page.url()).searchParams.has("sel")).toBe(false);
    const create = page.getByRole("button", { name: "Create", exact: true });
    await expect(create).toBeVisible();
    await expect(async () => {
      await create.click();
      await expect(page.locator(".createFabMenu")).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await page.locator(".createFabMenu").getByRole("link", { name: "Post a moment", exact: true }).click();
    await returnFromMoment(page, 390, returnTo);
  });
});

test("keyboard Moment activation keeps map context in a new tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/map?sel=venue-eltcmh");
  const share = page.getByRole("link", { name: "Share a Moment", exact: true });
  await expect(share).toBeVisible();
  // Drive the map's own state and URL writer through its visible controls.
  await page.getByRole("button", { name: "Drink: Pints", exact: true }).click();
  const wine = page.getByRole("group", { name: "Drink prices shown on the map", exact: true })
    .getByRole("button", { name: "Wine", exact: true });
  await wine.click();
  await expect(wine).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Drink: Wine", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/map\?sel=venue-eltcmh&drink=wine$/);
  await share.focus();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    share.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter"),
  ]);
  try {
    await expect(popup).toHaveURL(/\/moment\?/);
    expect(new URL(popup.url()).searchParams.get("returnTo")).toBe("/map?sel=venue-eltcmh&drink=wine");
    await expect(page).toHaveURL(/\/map\?sel=venue-eltcmh&drink=wine$/);
  } finally {
    await popup.close();
  }
});

for (const width of [390, 1440]) {
  test(`${width}px: mounted account switching hides old badges during a failed refresh`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const auth = await installAuthDoubles(page);
    let holdFirstAccount = false;
    let pendingReads = 0;
    let refusedReads = 0;
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await page.route((url) => url.pathname === "/api/messages" || url.pathname === "/api/notifications", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const bearer = request.headers().authorization;
      const account = Object.entries(ACCOUNTS).find(([key, value]) =>
        bearer === `Bearer pubmaxx-e2e-access-token-${key}` || bearer === `Bearer ${accessJwt(value)}`,
      )?.[1];
      if (!account || url.searchParams.get("handle") !== account.handle) {
        await route.fulfill({ status: 403, json: { error: "This account does not own that handle." } });
        return;
      }
      if (holdFirstAccount && account.id === ACCOUNTS.A.id) {
        pendingReads += 1;
        await pending;
        await route.fulfill({ status: 503, json: { error: "Unavailable", retryable: true } });
        refusedReads += 1;
        return;
      }
      await route.fulfill({ json: url.pathname === "/api/messages"
        ? { conversations: [{ unread: account.id === ACCOUNTS.B.id ? 5 : 0 }] }
        : { unread: account.id === ACCOUNTS.B.id ? 7 : 0 } });
    });
    await seedSignedIn(page, "A");
    await page.goto("/places");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
    await auth.signedInAs("B");
    await page.goto("/places");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);
    await expect(page.getByRole("link", { name: "Messages, 5 unread", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Activity: 7 unread", exact: true })).toBeVisible();
    const marker = await page.evaluate(() => {
      const value = crypto.randomUUID();
      document.documentElement.dataset.uxDocument = value;
      return value;
    });
    holdFirstAccount = true;
    await page.getByRole("button", { name: /Account options/ }).first().click();
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
    await page.locator(".authSwitcherRow").filter({ hasText: `@${ACCOUNTS.A.handle}` }).click();
    try {
      await expect.poll(() => pendingReads).toBeGreaterThanOrEqual(2);
      await expect(page.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: /(?:5|7) unread/ })).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("data-ux-document", marker);
      await page.screenshot({ path: info.outputPath("badges-pending-after-switch.png") });
    } finally {
      release();
    }
    await expect.poll(() => refusedReads).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("link", { name: "Messages", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/places$/);
    await page.screenshot({ path: info.outputPath("badges-refused-after-switch.png") });
  });
}

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
