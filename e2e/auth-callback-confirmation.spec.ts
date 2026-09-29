import { expect, test, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  accessJwt,
  installAuthDoubles,
} from "./helpers/authDoubles";

const SHOTS = "artifacts/auth-callback-confirmation";

type StoredSession = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
};

async function storedSession(page: Page): Promise<StoredSession | null> {
  return page.evaluate((key) => {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as StoredSession) : null;
  }, AUTH_STORAGE_KEY);
}

function callbackUrl(access: string, refresh: string, attemptId?: string): string {
  const query = new URLSearchParams({ _authCallback: "1" });
  if (attemptId) query.set("_authAttempt", attemptId);
  const fragment = new URLSearchParams({
    access_token: access,
    refresh_token: refresh,
    token_type: "bearer",
  });
  return `/today?${query}#${fragment}`;
}

async function expectScrubbed(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/today$/);
  expect(page.url()).not.toContain("access_token");
  expect(page.url()).not.toContain("refresh_token");
  expect(page.url()).not.toContain("_authCallback");
}

test.setTimeout(90_000);

test("unowned callback names account A before replacing account B; Cancel keeps B", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stub = await installAuthDoubles(page);
  await page.goto("/today");
  await stub.signedInAs("B");
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken));

  const prompt = page.getByRole("alert").filter({ hasText: `Sign in as ${ACCOUNTS.A.email}?` });
  await expect(prompt).toBeVisible();
  await expectScrubbed(page);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
  expect((await storedSession(page))?.refresh_token).toBe(ACCOUNTS.B.refreshToken);
  const labelBox = await prompt.locator("span").first().boundingBox();
  const actionsBox = await prompt.locator(".authCallbackNoticeActions").boundingBox();
  expect(labelBox?.width ?? 0).toBeGreaterThan(200);
  expect(actionsBox?.y ?? 0).toBeGreaterThan((labelBox?.y ?? 0) + (labelBox?.height ?? 0));
  await page.screenshot({ path: `${SHOTS}/390-confirmation.png` });

  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toHaveCount(0);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
  expect((await storedSession(page))?.refresh_token).toBe(ACCOUNTS.B.refreshToken);
  await expectScrubbed(page);
});

test("unowned callback installs verified account A only after Continue", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stub = await installAuthDoubles(page);
  await page.goto("/today");
  await stub.signedInAs("B");
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken));

  const prompt = page.getByRole("alert").filter({ hasText: `Sign in as ${ACCOUNTS.A.email}?` });
  await expect(prompt).toBeVisible();
  await expectScrubbed(page);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
  await page.screenshot({ path: `${SHOTS}/1440-confirmation.png` });

  await prompt.getByRole("button", { name: "Continue" }).click();
  await expect.poll(async () => (await storedSession(page))?.user.id).toBe(ACCOUNTS.A.id);
  expect((await storedSession(page))?.refresh_token).toBe(`${ACCOUNTS.A.refreshToken}-rotated`);
  await expectScrubbed(page);
});

test("mismatched access and refresh identities reject without replacing B", async ({ page }) => {
  const stub = await installAuthDoubles(page);
  await page.goto("/today");
  await stub.signedInAs("B");
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.B.refreshToken));

  await expect(page.locator(".authCallbackNotice")).toContainText("Sign-in could not be completed");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
  expect((await storedSession(page))?.refresh_token).toBe(ACCOUNTS.B.refreshToken);
  await expectScrubbed(page);
});

test("locally owned callback installs A automatically", async ({ page }) => {
  await installAuthDoubles(page);
  await page.goto("/today");
  const attemptId = "a".repeat(32);
  await page.evaluate((id) => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem("pubmax_auth_active_attempt", JSON.stringify({
      id, expiresAt, callbackClaimed: false,
    }));
    window.sessionStorage.setItem("pubmax_auth_tab_attempt", JSON.stringify({ id, expiresAt }));
  }, attemptId);
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken, attemptId));

  await expect.poll(async () => (await storedSession(page))?.user.id).toBe(ACCOUNTS.A.id);
  await expect(page.getByRole("alert").filter({ hasText: "Sign in as" })).toHaveCount(0);
  expect((await storedSession(page))?.refresh_token).toBe(ACCOUNTS.A.refreshToken);
  await expectScrubbed(page);
});
