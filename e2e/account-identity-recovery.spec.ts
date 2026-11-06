import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

// F14 is the oracle: a failed read is not a missing handle, Retry needs no
// document reload, and a late answer must not replace the active identity.
test.use({ serviceWorkers: "block" });

async function prepare(page: Page) {
  const auth = await installAuthDoubles(page);
  await storeThemeChoice(page, "light");
  await page.route(/\/api\/profiles\/(karan|karansznx)$/, (route) => {
    const account = route.request().url().endsWith("/karan") ? ACCOUNTS.A : ACCOUNTS.B;
    return route.fulfill({ json: {
      profile: { id: account.id, handle: account.handle, displayName: account.name,
        bio: "Disposable F14 profile", createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-01T12:00:00Z" },
      counts: { followers: 0, following: 0 }, socialLinks: [],
    } });
  });
  await page.route("**/api/social/access", (route) => route.fulfill({ json: {
    state: "verified", viewerHandle: ACCOUNTS.A.handle, draftScope: "a".repeat(43),
  } }));
  await page.route("**/api/social/posts**", (route) => route.fulfill({ json: { posts: [], nextCursor: null } }));
  await seedSignedIn(page, "A");
  return auth;
}

async function shot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: "image/png" });
}

async function markDocument(page: Page) {
  await page.locator("html").evaluate((root) => { root.dataset.f14Document = "original"; });
}

async function expectRecovered(page: Page, surface: string) {
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  if (surface === "you") {
    await expect(page).toHaveURL(new RegExp(`/u/${ACCOUNTS.A.handle}$`));
    await expect(page.locator(".profileDisplayName")).toHaveText(ACCOUNTS.A.name);
  } else {
    await expect(page.locator(".socialBoundary")).toHaveCount(0);
    await expect(page.getByText("No posts here yet.", { exact: true })).toBeVisible();
  }
  await expect(page.locator("html")).toHaveAttribute("data-f14-document", "original");
}

for (const surface of ["you", "social"] as const) {
  for (const failure of ["503", "malformed", "network"] as const) {
    test(`${surface}: Retry recovers from ${failure} without reloading`, async ({ page }, info) => {
      await page.setViewportSize({ width: surface === "you" ? 390 : 1440, height: 900 });
      await prepare(page);
      let recover = false;
      let reads = 0;
      await page.route("**/api/identity/handle/current", (route) => {
        reads += 1;
        if (recover) return route.fulfill({ json: { handle: ACCOUNTS.A.handle } });
        if (failure === "network") return route.abort("failed");
        return route.fulfill({ status: failure === "503" ? 503 : 200,
          json: failure === "503" ? { error: "unavailable" } : {} });
      });
      await page.goto(surface === "you" ? "/u/you" : "/social");
      const retry = page.getByRole("button", { name: "Retry", exact: true }).first();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("heading", { name: "Claim your @handle.", exact: true })).toHaveCount(0);
      await markDocument(page);
      await shot(page, info, "unavailable");
      const priorReads = reads;
      recover = true;
      await retry.click();
      await expect.poll(() => reads).toBeGreaterThan(priorReads);
      await expectRecovered(page, surface);
      await shot(page, info, "recovered");
    });
  }

  test(`${surface}: Retry ignores a stalled read after its late response`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await prepare(page);
    let recover = false;
    let started = 0;
    let completed = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/identity/handle/current", async (route) => {
      if (recover) return route.fulfill({ json: { handle: ACCOUNTS.A.handle } });
      started += 1;
      await held;
      await route.fulfill({ json: { handle: "obsolete" } });
      completed += 1;
    });
    try {
      await page.goto(surface === "you" ? "/u/you" : "/social");
      await expect.poll(() => started).toBeGreaterThan(0);
      const retry = page.getByRole("button", { name: "Retry", exact: true }).first();
      await expect(retry).toBeVisible({ timeout: 15_000 });
      await markDocument(page);
      await shot(page, info, "stalled");
      recover = true;
      await retry.click();
      await expectRecovered(page, surface);
      const late = page.waitForResponse(async (response) => response.url().endsWith("/api/identity/handle/current") &&
        (await response.json()).handle === "obsolete");
      release();
      await late;
      await expect.poll(() => completed).toBeGreaterThan(0);
      await expectRecovered(page, surface);
      await shot(page, info, "late-answer-rejected");
    } finally { release(); }
  });
}

test("a confirmed missing handle opens the claim form", async ({ page }, info) => {
  const auth = await prepare(page);
  auth.setServerHandle(null);
  await page.goto("/u/you");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Claim handle", exact: true })).toBeVisible();
  await expect(page.getByText("Your profile could not load", { exact: true })).toHaveCount(0);
  await shot(page, info, "confirmed-missing-handle");
});

test("switching accounts rejects the previous account's late identity", async ({ page }, info) => {
  test.setTimeout(60_000);
  await prepare(page);
  // Remember both sessions before testing the mounted account switch.
  await page.goto("/login");
  await expect(page.locator(".loginPageHandle")).toHaveText(`@${ACCOUNTS.A.handle}`);
  await page.evaluate(() => localStorage.setItem("__e2e_signed_in_account", "B"));
  await page.goto("/login");
  await expect(page.locator(".loginPageHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let started = 0;
  let completed = 0;
  await page.route("**/api/identity/handle/current", async (route) => {
    const bearer = await route.request().headerValue("authorization");
    // The B session restored on navigation carries the fixture's opaque token.
    if (bearer === "Bearer pubmaxx-e2e-access-token-B") {
      started += 1;
      await held;
      await route.fulfill({ json: { handle: ACCOUNTS.B.handle } });
      completed += 1;
    } else await route.fulfill({ json: { handle: ACCOUNTS.A.handle } });
  });
  try {
    await page.goto("/social");
    await expect.poll(() => started).toBeGreaterThan(0);
    await markDocument(page);
    await page.getByRole("button", { name: /Account options/ }).first().click();
    const menu = page.locator(".authAccountMenu");
    await menu.getByRole("button", { name: "Switch account", exact: true }).click();
    await menu.locator(".authSwitcherRow").filter({
      has: page.getByText(`@${ACCOUNTS.A.handle}`, { exact: true }),
    }).click();
    await expectRecovered(page, "social");
    release();
    await expect.poll(() => completed).toBeGreaterThan(0);
    await expectRecovered(page, "social");
    await shot(page, info, "active-account-after-late-identity");
  } finally { release(); }
});
