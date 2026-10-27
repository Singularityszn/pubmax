import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  accessJwt,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
  seedSignedIn,
} from "./helpers/authDoubles";

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

test("keyboard Moment activation keeps map context in a new tab", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/map?sel=venue-eltcmh");
  const share = page.getByRole("link", { name: "Share a Moment", exact: true });
  await expect(share).toBeVisible();
  await page.evaluate(() => history.replaceState(history.state, "", "/map?sel=venue-eltcmh&drink=wine"));
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
