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
    const response = await route.fetch({
      url: `${baseURL}${requested.pathname}${requested.search}`,
      maxRedirects: 0,
      headers: {
        ...route.request().headers(),
        origin: baseURL,
        "sec-fetch-site": "same-origin",
      },
    });
    const headers = response.headers();
    if (headers.location) {
      const destination = new URL(headers.location, baseURL);
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

test("phone sign-in returns through callback to Plan and persists the real SDK session", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
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
  await page.getByRole("navigation", { name: "Site navigation" }).getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/login?from=%2Fplan`);
  await expect(google).toBeVisible();
  await google.click();

  await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
  await expect.poll(() => providerStarts).toBe(1);
  await expect.poll(() => callbackLandings).toBe(1);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), AUTH_STORAGE_KEY)).not.toBeNull();
  await expect.poll(() => resumeCookie(page)).toBeTruthy();
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/karan");
  await page.screenshot({ path: testInfo.outputPath("signed-in-plan-phone.png") });

  await page.reload();
  await expect(page).toHaveURL(`${CANONICAL_ORIGIN}/plan`);
  await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "You" })).toHaveAttribute("href", "/u/karan");
  await page.goto(`${CANONICAL_ORIGIN}/moment?returnTo=%2Fplan`);
  await expect(page.getByText("Sign in when you are ready to keep this Moment across devices.")).toHaveCount(0);
});
