import { expect, test } from "@playwright/test";

const SUPABASE_HOST = "https://pubmaxx-e2e.supabase.co";
// A production build hands every OAuth start on any other origin off to
// pubmaxxing.com first (lib/siteUrl.ts canonicalAuthStartUrl), so the Azure
// request is only made from the canonical origin. Serve that origin from the
// local server so the spec reaches it without touching the network.
const CANONICAL_ORIGIN = "https://pubmaxxing.com";

function serveCanonicalOriginLocally(page: import("@playwright/test").Page, baseURL: string) {
  return page.route(`${CANONICAL_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
}

function stubAuthProviders(page: import("@playwright/test").Page, external: Record<string, boolean>) {
  return Promise.all([
    page.route("**/api/auth/providers**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "cache-control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
        },
        body: JSON.stringify({
          google: external.google === true,
          apple: external.apple === true,
          microsoft: external.azure === true,
        }),
      });
    }),
    page.route(`${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/authorize")) {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<p>authorize</p>" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    });
    }),
  ]);
}

test.describe("Microsoft sign-in button", () => {
  // A cached shell from a service worker would skip the canonical-origin route.
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    });
  });

  // The canonical-origin proxy can still be fetching a late asset when a test
  // ends. Drop the routes so that fetch cannot fail the worker after the test.
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("shows Microsoft when Azure is enabled and starts Azure OAuth", async ({ page, baseURL }) => {
    // Playwright tries the newest route first. The canonical-origin proxy also
    // matches the canonical /api/auth/providers, so it is registered first and
    // the provider stub answers that read instead of the keyless server's 503.
    await serveCanonicalOriginLocally(page, baseURL ?? "");
    await stubAuthProviders(page, { google: false, apple: false, azure: true, email: true });
    await page.goto(`${CANONICAL_ORIGIN}/login`);

    const microsoft = page.getByRole("button", { name: "Continue with Microsoft" });
    await expect(microsoft).toBeVisible();

    const [authorize] = await Promise.all([
      page.waitForRequest((request) => request.url().startsWith(`${SUPABASE_HOST}/auth/v1/authorize`), {
        timeout: 20_000,
      }),
      microsoft.click(),
    ]);

    const params = new URL(authorize.url()).searchParams;
    expect(params.get("provider")).toBe("azure");
    expect(params.get("scopes")?.split(" ")).toEqual(expect.arrayContaining(["email", "openid", "profile"]));
    const redirectTo = new URL(params.get("redirect_to") ?? "");
    expect(redirectTo.origin).toBe(CANONICAL_ORIGIN);
    expect(redirectTo.pathname).toBe("/auth/callback");
  });

  test("hides Microsoft when Azure is disabled", async ({ page }) => {
    await stubAuthProviders(page, { google: true, apple: false, azure: false, email: true });
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toHaveCount(0);
  });
});
