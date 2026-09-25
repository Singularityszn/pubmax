import { expect, test } from "@playwright/test";

const SUPABASE_HOST = "https://pubmaxx-e2e.supabase.co";
const MICROSOFT_AUTHORIZE =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=e2e";

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
      await route.fulfill({
        status: 302,
        headers: {
          "access-control-allow-origin": "*",
          location: MICROSOFT_AUTHORIZE,
        },
      });
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

  test("shows Microsoft when Azure is enabled and starts OAuth toward Microsoft", async ({ page }) => {
    await stubSupabaseSettings(page, { google: false, apple: false, azure: true, email: true });
    await page.goto("/login");

    const microsoft = page.getByRole("button", { name: "Continue with Microsoft" });
    await expect(microsoft).toBeVisible();

    await Promise.all([
      page.waitForURL((url) => url.href.startsWith(MICROSOFT_AUTHORIZE), { timeout: 20_000 }),
      microsoft.click(),
    ]);
  });

  test("hides Microsoft when Azure is disabled", async ({ page }) => {
    await stubSupabaseSettings(page, { google: false, apple: false, azure: false, email: true });
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "Continue with Microsoft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  });

  test("shows Google when enabled alongside stubbed settings", async ({ page }) => {
    await stubSupabaseSettings(page, { google: true, apple: false, azure: false, email: true });
    await page.goto("/login");

    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  });
});
