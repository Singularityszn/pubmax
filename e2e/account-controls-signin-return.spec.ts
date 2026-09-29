import { expect, test, type Page } from "@playwright/test";

import {
  ACCOUNTS,
  AUTH_STORAGE_KEY,
  installAuthDoubles,
  resumeCookie,
} from "./helpers/authDoubles";

const CANONICAL_ORIGIN = "https://pubmaxxing.com";
const SUPABASE_ORIGIN = "https://pubmaxx-e2e.supabase.co";

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

function accessToken(): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({ sub: ACCOUNTS.A.id, email: ACCOUNTS.A.email, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
    Buffer.from("e2e-signature").toString("base64url"),
  ].join(".");
}

async function serveCanonicalOriginLocally(page: Page, baseURL: string, onCallback: () => void): Promise<void> {
  await page.route(`${CANONICAL_ORIGIN}/**`, async (route) => {
    const requested = new URL(route.request().url());
    const requestHeaders = route.request().headers();
    const response = await route.fetch({
      url: `${baseURL}${requested.pathname}${requested.search}`,
      maxRedirects: 0,
      headers: {
        ...requestHeaders,
        ...(requestHeaders.origin === CANONICAL_ORIGIN ? { origin: baseURL } : {}),
      },
    });
    const headers = response.headers();
    if (headers.location) {
      const destination = new URL(headers.location, baseURL);
      expect(destination.origin).toBe(new URL(baseURL).origin);
      headers.location = `${CANONICAL_ORIGIN}${destination.pathname}${destination.search}${destination.hash}`;
    }
    if (requested.pathname === "/auth/callback") {
      onCallback();
      expect(response.status()).toBe(307);
      expect(new URL(headers.location).pathname).toBe("/plan");
      // Browser routing cannot intercept the next hop of a fulfilled HTTP
      // redirect. Start a new navigation so Plan also stays on the local app.
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(headers.location)} + location.hash)</script>`,
      });
      return;
    }
    await route.fulfill({ response, headers });
  });
}

for (const device of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${device.name} sign-in returns through callback to Plan and persists the real SDK session`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    let callbackLandings = 0;
    await serveCanonicalOriginLocally(page, baseURL ?? "", () => { callbackLandings += 1; });
    await installAuthDoubles(page, { initialSeedOnly: true, realResumeCookie: true });
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/settings`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ external: { google: true, apple: false, azure: false } }),
      }),
    );

    let providerStarts = 0;
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/authorize?**`, async (route) => {
      providerStarts += 1;
      const callback = new URL(new URL(route.request().url()).searchParams.get("redirect_to") ?? "");
      expect(callback.origin).toBe(CANONICAL_ORIGIN);
      expect(callback.pathname).toBe("/auth/callback");
      expect(callback.searchParams.get("next")).toBe("/plan");
      const fragment = new URLSearchParams({
        access_token: accessToken(),
        refresh_token: ACCOUNTS.A.refreshToken,
        token_type: "bearer",
        expires_in: "3600",
      });
      // Model the provider return as a document navigation. A fulfilled 302
      // would let its next hop escape Playwright's local-origin route.
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(`${callback.toString()}#${fragment.toString()}`)})</script>`,
      });
    });

    await page.goto("/login?from=%2Fplan");
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
    const google = page.getByRole("button", { name: "Continue with Google" });
    await expect(google).toBeVisible();
    await google.click();
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    expect(providerStarts).toBe(0);
    const siteNav = page.getByRole("navigation", { name: "Site navigation" });
    if (device.name === "phone") {
      await siteNav.getByRole("link", { name: "Sign in" }).click();
    } else {
      await siteNav.getByRole("button", { name: "Sign in" }).click();
      await siteNav.getByRole("link", { name: "Open full sign-in page" }).click();
    }
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/login?from=%2Fplan`);
    await expect(google).toBeVisible();
    await google.click();

    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    await expect.poll(() => providerStarts).toBe(1);
    await expect.poll(() => callbackLandings).toBe(1);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).not.toBeNull();
    await expect.poll(() => resumeCookie(page, CANONICAL_ORIGIN)).toBeTruthy();
    const expectAccountNavigation = async () => {
      if (device.name === "phone") {
        await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/karan");
        return;
      }
      const accountButton = siteNav.getByRole("button", { name: /^Account options for / });
      const profileLink = page.getByRole("navigation", { name: "Your pages" }).getByRole("link", { name: "Your profile" });
      await accountButton.click();
      await expect(profileLink).toHaveAttribute("href", "/u/karan");
      await accountButton.click();
      await expect(profileLink).toHaveCount(0);
    };
    await expectAccountNavigation();
    await page.screenshot({ path: testInfo.outputPath(`signed-in-plan-${device.name}.png`) });

    await page.reload();
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    await expectAccountNavigation();
    await page.goto(`${CANONICAL_ORIGIN}/moment?returnTo=%2Fplan`);
    await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
  });
}

for (const device of [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
]) {
  test(`${device.name} email link sends OTP and returns through callback with a persistent session`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: device.width, height: device.height });
    let callbackLandings = 0;
    await serveCanonicalOriginLocally(page, baseURL ?? "", () => { callbackLandings += 1; });
    await installAuthDoubles(page, { initialSeedOnly: true, realResumeCookie: true });

    let emailCallback: URL | null = null;
    let otpRequests = 0;
    await page.route(`${SUPABASE_ORIGIN}/auth/v1/otp?**`, async (route) => {
      otpRequests += 1;
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON() as { email?: string; create_user?: boolean };
      expect(body.email).toBe(ACCOUNTS.A.email);
      expect(body.create_user).toBe(true);
      const redirectTo = new URL(route.request().url()).searchParams.get("redirect_to");
      expect(redirectTo).toBeTruthy();
      emailCallback = new URL(redirectTo as string);
      expect(emailCallback.origin).toBe(CANONICAL_ORIGIN);
      expect(emailCallback.pathname).toBe("/auth/callback");
      expect(emailCallback.searchParams.get("next")).toBe("/plan");
      expect(emailCallback.searchParams.get("_authAttempt")).toBeTruthy();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: "{}",
      });
    });

    await page.goto("/login?from=%2Fplan");
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();
    const emailField = page.getByRole("textbox", { name: "Sign in with your email" });
    const sendLink = page.getByRole("button", { name: "Email me a sign-in link" });
    await emailField.fill(ACCOUNTS.A.email);
    await sendLink.click();
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    expect(otpRequests).toBe(0);
    const siteNav = page.getByRole("navigation", { name: "Site navigation" });
    if (device.name === "phone") {
      await siteNav.getByRole("link", { name: "Sign in" }).click();
    } else {
      await siteNav.getByRole("button", { name: "Sign in" }).click();
      await siteNav.getByRole("link", { name: "Open full sign-in page" }).click();
    }
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/login?from=%2Fplan`);
    await emailField.fill(ACCOUNTS.A.email);
    await sendLink.click();
    await expect(page.getByRole("button", { name: "Link sent" })).toBeDisabled();
    await expect.poll(() => otpRequests).toBe(1);
    expect(await page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).toBeNull();

    // The controlled provider delivers the requested link with an implicit-flow
    // fragment after verification. The app's callback and SDK remain real.
    expect(emailCallback).not.toBeNull();
    const fragment = new URLSearchParams({
      access_token: accessToken(),
      refresh_token: ACCOUNTS.A.refreshToken,
      token_type: "bearer",
      expires_in: "3600",
    });
    await page.goto(`${emailCallback!.toString()}#${fragment.toString()}`);
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    await expect.poll(() => callbackLandings).toBe(1);
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).not.toBeNull();
    await expect.poll(() => resumeCookie(page, CANONICAL_ORIGIN)).toBeTruthy();
    const expectAccountNavigation = async () => {
      if (device.name === "phone") {
        await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/karan");
        return;
      }
      const accountButton = siteNav.getByRole("button", { name: /^Account options for / });
      const profileLink = page.getByRole("navigation", { name: "Your pages" }).getByRole("link", { name: "Your profile" });
      await accountButton.click();
      await expect(profileLink).toHaveAttribute("href", "/u/karan");
      await accountButton.click();
      await expect(profileLink).toHaveCount(0);
    };
    await expectAccountNavigation();
    await page.screenshot({ path: testInfo.outputPath(`email-signed-in-plan-${device.name}.png`) });

    await page.reload();
    await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
    await expectAccountNavigation();
    await page.goto(`${CANONICAL_ORIGIN}/moment?returnTo=%2Fplan`);
    await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
  });
}
