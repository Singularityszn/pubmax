import { expect, test, type Page } from "@playwright/test";

import type { ConversationDTO } from "../lib/messages";
import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  accessJwt,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
  seedSignedIn,
  type AccountKey,
  type Stub,
} from "./helpers/authDoubles";

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

function siteNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Site navigation", exact: true });
}

function messagesLink(page: Page) {
  return siteNavigation(page).locator('a[href="/messages"]');
}

function accountForBearer(header: string | undefined): AccountKey | null {
  const token = header?.replace(/^Bearer\s+/i, "");
  for (const key of ["A", "B"] as const) {
    if (token === `pubmaxx-e2e-access-token-${key}` || token === accessJwt(ACCOUNTS[key])) {
      return key;
    }
  }
  return null;
}

function inboxRow(account: AccountKey): ConversationDTO {
  return {
    id: `inbox-${account}`,
    otherHandle: "alex",
    kind: "direct",
    lastBody: `Unread messages for ${ACCOUNTS[account].handle}`,
    lastAt: "2026-10-01T19:00:00.000Z",
    lastFromMe: false,
    unread: account === "A" ? 3 : 7,
  };
}

async function installMessagesRead(page: Page) {
  const reads: AccountKey[] = [];
  const rejected: { handle: string | null; account: AccountKey | null }[] = [];
  let holdB = false;
  let heldBRequests = 0;
  let releaseB!: () => void;
  const bReleased = new Promise<void>((resolve) => { releaseB = resolve; });

  await page.route("**/api/messages?**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      await route.fallback();
      return;
    }
    const account = accountForBearer(request.headers().authorization);
    const handle = new URL(request.url()).searchParams.get("handle");
    // A's bearer never receives B's inbox, even while B is being installed.
    if (!account || handle !== ACCOUNTS[account].handle) {
      rejected.push({ handle, account });
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "Inbox owner does not match this credential." }),
      });
      return;
    }
    reads.push(account);
    if (account === "B" && holdB) {
      heldBRequests += 1;
      await bReleased;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ conversations: [inboxRow(account)], status: "ready" }),
    });
  });

  return {
    reads,
    rejected,
    holdB: () => { holdB = true; },
    heldBRequests: () => heldBRequests,
    releaseB,
  };
}

async function expectSdkAccount(page: Page, account: AccountKey | null) {
  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const session = JSON.parse(raw) as { user?: { id?: string } };
    return session.user?.id ?? null;
  }, AUTH_STORAGE_KEY)).toBe(account ? ACCOUNTS[account].id : null);
}

async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: /Account options/ }).first().click();
  await expect(page.locator(".authAccountMenu")).toBeVisible();
}

async function seedRememberedBThenActiveA(page: Page, auth: Stub) {
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await auth.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await auth.signedInAs("A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect.poll(async () => (await readDeviceAccounts(page)).map((row) => row.userId).sort())
    .toEqual([ACCOUNTS.A.id, ACCOUNTS.B.id].sort());
}

test("switching accounts clears A's unread badge before B's inbox answers", async ({ page }) => {
  test.setTimeout(120_000);
  const auth = await installAuthDoubles(page, { initialSeedOnly: true });
  const messages = await installMessagesRead(page);
  await seedRememberedBThenActiveA(page, auth);
  await expectSdkAccount(page, "A");
  await expect(messagesLink(page)).toHaveAttribute("aria-label", "Messages, 3 unread");
  await expect(messagesLink(page).locator(".siteNavBellBadge")).toHaveText("3");
  expect(messages.reads).toContain("A");
  const originalNav = await siteNavigation(page).elementHandle();
  if (!originalNav) throw new Error("Mounted A site navigation is missing.");

  messages.holdB();
  try {
    // Only setup navigates. This switch uses the remembered account control,
    // real Supabase setSession and AuthProvider's live subscription.
    await openAccountMenu(page);
    await page.locator(".authAccountMenu").getByRole("button", { name: "Switch account" }).click();
    const accountB = page.locator(".authAccountMenu .authSwitcherRow")
      .filter({ hasText: ACCOUNTS.B.handle });
    await expect(accountB).toBeVisible();
    await accountB.click();

    await expectSdkAccount(page, "B");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(messages.heldBRequests).toBeGreaterThan(0);
    await expect(page).toHaveURL(/\/today$/);
    expect(await originalNav.evaluate((nav) => nav.isConnected)).toBe(true);
    expect(await siteNavigation(page).evaluate((nav, original) => nav === original, originalNav)).toBe(true);
    await expect(messagesLink(page)).toHaveAttribute("aria-label", "Messages");
    await expect(messagesLink(page).locator(".siteNavBellBadge")).toHaveCount(0);

    messages.releaseB();
    // This count was absent while B's response was held, so it proves the
    // released B body reached the current link rather than an old A poll.
    await expect(messagesLink(page)).toHaveAttribute("aria-label", "Messages, 7 unread");
    await expect(messagesLink(page).locator(".siteNavBellBadge")).toHaveText("7");
    expect(await originalNav.evaluate((nav) => nav.isConnected)).toBe(true);
    expect(await siteNavigation(page).evaluate((nav, original) => nav === original, originalNav)).toBe(true);
    expect(messages.rejected).toEqual([]);
  } finally {
    messages.releaseB();
    await originalNav.dispose();
  }
});

test("signing out clears A's unread badge in the existing navigation", async ({ page }) => {
  test.setTimeout(120_000);
  const auth = await installAuthDoubles(page, { initialSeedOnly: true });
  const messages = await installMessagesRead(page);
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expectSdkAccount(page, "A");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(messagesLink(page)).toHaveAttribute("aria-label", "Messages, 3 unread");
  await expect(messagesLink(page).locator(".siteNavBellBadge")).toHaveText("3");
  expect(messages.reads).toContain("A");
  const originalNav = await siteNavigation(page).elementHandle();
  if (!originalNav) throw new Error("Mounted A site navigation is missing.");

  try {
    auth.serverSignedInAs(null);
    await openAccountMenu(page);
    await page.locator(".authAccountMenu").getByRole("button", { name: "Sign out", exact: true }).click();

    await expectSdkAccount(page, null);
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBeNull();
    await expect(siteNavigation(page)
      .getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/today$/);
    expect(await originalNav.evaluate((nav) => nav.isConnected)).toBe(true);
    expect(await siteNavigation(page).evaluate((nav, original) => nav === original, originalNav)).toBe(true);
    await expect(messagesLink(page)).toHaveAttribute("aria-label", "Messages");
    await expect(messagesLink(page).locator(".siteNavBellBadge")).toHaveCount(0);
    expect(messages.rejected).toEqual([]);
  } finally {
    messages.releaseB();
    await originalNav.dispose();
  }
});
