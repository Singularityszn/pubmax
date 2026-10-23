import { expect, test, type Page, type Route } from "@playwright/test";

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

test("unowned callback for an unverified email asks without naming the address", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stub = await installAuthDoubles(page);
  await page.goto("/today");
  await stub.signedInAs("B");
  // Whoever crafts the link can set an unverified email to anything, such as
  // the address of the person they send it to.
  const chosenEmail = ACCOUNTS.B.email;
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() === "OPTIONS" ||
      route.request().headers().authorization !== `Bearer ${accessJwt(ACCOUNTS.A)}`) {
      return route.fallback();
    }
    await route.fulfill({
      status: 200,
      headers: providerHeaders,
      json: {
        id: ACCOUNTS.A.id,
        aud: "authenticated",
        role: "authenticated",
        email: chosenEmail,
        email_confirmed_at: null,
        app_metadata: {},
        user_metadata: {},
      },
    });
  });
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken));

  const prompt = page.getByRole("alert").filter({ hasText: "Sign in to this account?" });
  await expect(prompt).toBeVisible();
  await expect(page.getByText(chosenEmail)).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Sign in as" })).toHaveCount(0);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
  await page.screenshot({ path: `${SHOTS}/390-confirmation-unverified.png` });

  await prompt.getByRole("button", { name: "Cancel" }).click();
  await expect(prompt).toHaveCount(0);
  expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
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

// The per-load greeting fix must not silence a GENUINE sign-in: a signed-out
// tab that opens its own emailed link is greeted and counted once, and the
// reloads after it are neither. Product events go to /api/events, not ingest.
test("owned callback in a signed-out tab is greeted and counted once; a reload is not", async ({ page }) => {
  const stub = await installAuthDoubles(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
  });
  const events: string[] = [];
  await page.route("**/api/events", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { name?: unknown };
    if (typeof body.name === "string") events.push(body.name);
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  const greeting = page.getByText(`Welcome back, @${ACCOUNTS.A.handle}.`);
  await page.goto("/today");
  const attemptId = "b".repeat(32);
  await page.evaluate((id) => {
    const expiresAt = Date.now() + 60_000;
    window.localStorage.setItem("pubmax_auth_active_attempt", JSON.stringify({
      id, expiresAt, callbackClaimed: false,
    }));
    window.sessionStorage.setItem("pubmax_auth_tab_attempt", JSON.stringify({ id, expiresAt }));
  }, attemptId);
  await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken, attemptId));

  await expect(greeting).toBeVisible();
  await expect.poll(() => events.filter((name) => name === "user_signed_in")).toHaveLength(1);

  // From here the device holds A's session on every load, as it would.
  await stub.signedInAs("A");
  for (let load = 0; load < 2; load += 1) {
    await page.reload();
    await expect(page.locator("nav").first()).toBeVisible();
    await page.waitForTimeout(3_000);
    await expect(greeting).toHaveCount(0);
  }
  expect(events.filter((name) => name === "user_signed_in")).toHaveLength(1);
});

const providerHeaders = {
  "access-control-expose-headers": "x-supabase-api-version",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

async function providerError(route: Route, status: number, code: string, message: string): Promise<void> {
  const versioned = route.request().headers()["x-supabase-api-version"] === "2024-01-01";
  await route.fulfill({
    status,
    headers: {
      ...providerHeaders,
      ...(versioned ? { "x-supabase-api-version": "2024-01-01" } : {}),
    },
    json: versioned ? { code, message } : { code: status, error_code: code, msg: message },
  });
}

for (const read of [1, 2]) {
  test(`revoked callback identity read ${read} preserves stored B`, async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await page.goto("/today");
    await stub.signedInAs("B");
    let reads = 0;
    await page.route("**/auth/v1/user", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      if (route.request().headers().authorization === `Bearer ${accessJwt(ACCOUNTS.A)}` && ++reads === read) {
        await providerError(route, 403, "session_not_found", "Session from session_id claim in JWT does not exist");
      } else await route.fallback();
    });
    await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken));
    await expect(page.locator(".authCallbackNotice")).toBeVisible();
    expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
    await expect(page.locator(".authCallbackNotice")).toContainText("Sign-in could not be completed");
    expect((await storedSession(page))?.refresh_token).toBe(ACCOUNTS.B.refreshToken);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    await expectScrubbed(page);
  });
}

for (const failure of ["503", "network", "unknown"] as const) {
  test(`${failure} identity lookup rejects mismatched callback without replacing B`, async ({ page }) => {
    const stub = await installAuthDoubles(page);
    await page.goto("/today");
    await stub.signedInAs("B");
    await page.route("**/auth/v1/user", async (route) => {
      if (route.request().method() === "OPTIONS" || route.request().headers().authorization !== `Bearer ${accessJwt(ACCOUNTS.A)}`) {
        return route.fallback();
      }
      if (failure === "network") return route.abort("failed");
      await providerError(route, failure === "503" ? 503 : 403, "unexpected_failure", "Identity unavailable");
    });
    await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.B.refreshToken));
    await expect(page.locator(".authCallbackNotice")).toContainText("Sign-in could not be completed");
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
    await expectScrubbed(page);
  });
}

for (const action of ["Continue", "Cancel"]) {
  test(`delayed cookie restoration finishes before callback ${action}`, async ({ page }) => {
    await installAuthDoubles(page);
    let finishRedemption!: () => void;
    const redemption = new Promise<void>((resolve) => { finishRedemption = resolve; });
    let startedRedemption!: () => void;
    const started = new Promise<void>((resolve) => { startedRedemption = resolve; });
    await page.route("**/api/auth/session", async (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ json: { hint: { maskedEmail: "b@example.test" } } });
      }
      if (route.request().postDataJSON()?.action !== "redeem") return route.fallback();
      startedRedemption();
      await redemption;
      await route.fulfill({ json: { status: "restored", session: {
        access_token: accessJwt(ACCOUNTS.B), refresh_token: ACCOUNTS.B.refreshToken,
      } } });
    });
    await page.goto(callbackUrl(accessJwt(ACCOUNTS.A), ACCOUNTS.A.refreshToken));
    await started;
    try {
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
    } finally {
      finishRedemption();
    }
    const prompt = page.getByRole("alert").filter({ hasText: `Sign in as ${ACCOUNTS.A.email}?` });
    await expect(prompt).toBeVisible();
    expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
    await prompt.getByRole("button", { name: action, exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(async () => (await storedSession(page))?.user.id).toBe(ACCOUNTS[action === "Continue" ? "A" : "B"].id);
    await expectScrubbed(page);
  });
}

for (const { refreshAccount, clock } of (["A", "B"] as const).flatMap((refreshAccount) =>
  (["aligned", "behind"] as const).map((clock) => ({ refreshAccount, clock })),
)) {
  test(`expired cross-browser access A with refresh ${refreshAccount}, clock ${clock}`, async ({ page }) => {
    const providerNow = Date.now();
    await page.clock.setFixedTime(new Date(providerNow - (clock === "behind" ? 120_000 : 0)));
    const stub = await installAuthDoubles(page);
    await page.goto("/today");
    await stub.signedInAs("B");
    const parts = accessJwt(ACCOUNTS.A).split(".");
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    parts[1] = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(providerNow / 1000) - 60 })).toString("base64url");
    const expired = parts.join(".");
    await page.route("**/auth/v1/user", async (route) => {
      if (route.request().headers().authorization !== `Bearer ${expired}`) return route.fallback();
      await providerError(route, 403, "bad_jwt",
        "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired");
    });
    await page.goto(callbackUrl(expired, ACCOUNTS[refreshAccount].refreshToken));
    if (refreshAccount === "A") {
      const prompt = page.getByRole("alert").filter({ hasText: `Sign in as ${ACCOUNTS.A.email}?` });
      await expect(prompt).toBeVisible();
      expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
      await prompt.getByRole("button", { name: "Continue", exact: true }).click();
      await expect.poll(async () => (await storedSession(page))?.user.id).toBe(ACCOUNTS.A.id);
      expect((await storedSession(page))?.refresh_token).toBe(`${ACCOUNTS.A.refreshToken}-rotated`);
    } else {
      await expect(page.locator(".authCallbackNotice")).toContainText("Sign-in could not be completed");
      expect((await storedSession(page))?.user.id).toBe(ACCOUNTS.B.id);
    }
    await expectScrubbed(page);
  });
}
