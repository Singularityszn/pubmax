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

function stubSupabaseSettings(page: import("@playwright/test").Page, external: Record<string, boolean>) {
  return page.route(`${SUPABASE_HOST}/**`, async (route) => {
    const url = route.request().url();
    if (url.includes("/auth/v1/settings")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ external }),
      });
      return;
    }
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
  });
}

test.describe("Microsoft sign-in button", () => {
  // A cached shell from a service worker would skip the canonical-origin route.
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await page.route("**/_vercel/insights/script.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
    );
    await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-theme", "light");
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    });
  });

  test("shows Microsoft when Azure is enabled and starts Azure OAuth", async ({ page, baseURL }) => {
    await stubSupabaseSettings(page, { google: false, apple: false, azure: true, email: true });
    await serveCanonicalOriginLocally(page, baseURL ?? "");
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
    await stubSupabaseSettings(page, { google: true, apple: false, azure: false, email: true });
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toHaveCount(0);
  });
});
