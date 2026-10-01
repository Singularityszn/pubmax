import { expect, test } from "@playwright/test";

import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  decodeResumeCookie,
  accessJwt,
  installAuthDoubles,
  observeHeldResumeCancellation,
  readDeviceIdentity,
  resumeCookie,
  seedSignedIn,
} from "./helpers/authDoubles";

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

test("a held A resume cannot replace B signed in from another tab", async ({ context, page, baseURL }) => {
  test.setTimeout(120_000);
  await installAuthDoubles(page, { initialSeedOnly: true, realResumeCookie: true });
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect.poll(() => resumeCookie(page, baseURL)).toBeTruthy();
  const resumeObservation = await observeHeldResumeCancellation(page, {
    access_token: accessJwt(ACCOUNTS.A),
    refresh_token: ACCOUNTS.A.refreshToken,
  });

  // Start a cold restore with A's durable cookie, then hold its answer while a
  // second tab completes B's normal callback and publishes the new SDK session.
  await page.evaluate((key) => {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem("__e2e_signed_in_account");
  }, AUTH_STORAGE_KEY);
  let redeemRequests = 0;
  let markRedeemHeld: (() => void) | null = null;
  const redeemHeld = new Promise<void>((resolve) => { markRedeemHeld = resolve; });
  let releaseA: (() => Promise<void>) | null = null;
  await page.route("**/api/auth/session", async (route) => {
    const request = route.request();
    const action = request.method() === "POST"
      ? (request.postDataJSON() as { action?: string } | null)?.action
      : null;
    if (action !== "redeem") {
      await route.fallback();
      return;
    }
    redeemRequests += 1;
    markRedeemHeld?.();
    await new Promise<void>((resolve) => {
      releaseA = async () => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "restored",
            session: {
              access_token: accessJwt(ACCOUNTS.A),
              refresh_token: ACCOUNTS.A.refreshToken,
            },
          }),
        });
        resolve();
      };
    });
  });

  try {
    await page.reload();
    await redeemHeld;
    expect(redeemRequests).toBe(1);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
    await resumeObservation.arm();

    const secondTab = await context.newPage();
    const secondTabAuth = await installAuthDoubles(secondTab, { initialSeedOnly: true, realResumeCookie: true });
    await secondTab.goto("/today");
    await secondTabAuth.signedInAs("B");
    await secondTab.goto("/today");
    await expect.poll(async () => (await readDeviceIdentity(secondTab)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(async () => page.evaluate((key) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) ?? "{}").user?.id ?? null;
      } catch {
        return null;
      }
    }, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.B.id);
    await expect.poll(async () =>
      decodeResumeCookie(await resumeCookie(page, baseURL))?.rt,
    ).toBe(ACCOUNTS.B.refreshToken);

    expect(await resumeObservation.read()).toEqual(["restore-cancelled"]);
    await releaseA?.();
    // The first read stops bootstrap's SDK install; the second finishes the
    // provider's awaited bootstrap without publishing the retired account.
    await expect.poll(resumeObservation.read).toEqual([
      "restore-cancelled", "A-body-read", "captured-signal-read", "captured-signal-read",
    ]);
    await expect.poll(async () => page.evaluate((key) => {
      try {
        return JSON.parse(window.localStorage.getItem(key) ?? "{}").user?.id ?? null;
      } catch {
        return null;
      }
    }, AUTH_STORAGE_KEY)).toBe(ACCOUNTS.B.id);
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect.poll(async () =>
      decodeResumeCookie(await resumeCookie(page, baseURL))?.rt,
    ).toBe(ACCOUNTS.B.refreshToken);
  } finally {
    await resumeObservation.dispose();
  }
});
