import { expect, test } from "@playwright/test";
import { AUTH_STORAGE_KEY, stubSocialAuthProviders } from "./helpers/authDoubles";

const IPHONE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

// Disposable GoTrue and Capacitor transport fixtures exercise the production
// AuthProvider, SDK, App callback consumer and navigation. This is browser proof.
const owner = {
  id: "00000000-0000-4000-8000-0000000000e1",
  email: "native-reload@example.test",
  email_confirmed_at: "2026-01-01T00:00:00.000Z",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
};
const handle = "disposable_owner";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
test.afterEach(async ({ page }) => {
  // Drain the private-origin proxy before Playwright disposes its responses.
  await page.unrouteAll({ behavior: "wait" });
});

for (const theme of ["light", "dark"] as const) {
  test(`warm email return retains the canonical You anchor after reload in ${theme}`, async ({ page, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    // Production initiates auth only on its canonical origin. Serve that origin
    // from this run's private app, including assets, without contacting the site.
    await page.route("https://pubmaxxing.com/**", async (route) => {
      const publicUrl = new URL(route.request().url());
      // Specific auth/identity/profile doubles below take precedence. Other
      // private data has no verified server account in this disposable build.
      if (publicUrl.pathname.startsWith("/api/")) {
        await route.fulfill({ status: 401, json: { error: "Sign in to read private data.", code: "UNAUTHENTICATED" } });
        return;
      }
      const localUrl = new URL(publicUrl.pathname + publicUrl.search, baseURL);
      const response = await route.fetch({
        url: localUrl.toString(),
        headers: { ...route.request().headers(), host: localUrl.host },
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    });
    await page.addInitScript((selectedTheme) => {
      localStorage.setItem("pubmax-theme", selectedTheme);
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      const listeners = new Map<string, (event: { url: string }) => void>();
      let sequence = 0;
      const target = window as unknown as {
        CapacitorCustomPlatform: { name: string };
        Capacitor: unknown;
        nativeEmailFixture: { count: () => number; deliver: (url: string) => void };
      };
      target.CapacitorCustomPlatform = { name: "ios" };
      target.Capacitor = {
        getPlatform: () => "ios",
        isNativePlatform: () => true,
        PluginHeaders: [{ name: "App", methods: [
          { name: "addListener", rtype: "callback" },
          { name: "removeListener", rtype: "promise" },
          { name: "getLaunchUrl", rtype: "promise" },
        ] }],
        nativeCallback: (_plugin: string, method: string, options: { eventName: string }, callback: (event: { url: string }) => void) => {
          const id = String(++sequence);
          if (method === "addListener" && options.eventName === "appUrlOpen") listeners.set(id, callback);
          return Promise.resolve(id);
        },
        nativePromise: async (_plugin: string, method: string, options?: { callbackId: string }) => {
          if (method === "removeListener" && options) listeners.delete(options.callbackId);
          return {};
        },
      };
      target.nativeEmailFixture = {
        count: () => listeners.size,
        deliver: (url) => { for (const listener of listeners.values()) listener({ url }); },
      };
    }, theme);
    await stubSocialAuthProviders(page);
    await page.route("**/api/auth/session", (route) => route.fulfill({ json: route.request().method() === "GET" ? { hint: null } : { ok: true } }));
    await page.route("**/api/identity/handle/current", (route) => route.fulfill({ json: { handle } }));
    await page.route("**/api/identity/onboarding", (route) => route.fulfill({ json: { complete: true, handle } }));
    await page.route(`**/api/profiles/${handle}`, (route) => route.fulfill({ json: {
      profile: { id: owner.id, handle, displayName: "Disposable owner", bio: "", createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
      socialLinks: [], counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false,
    } }));
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const access = ["e30", Buffer.from(JSON.stringify({ sub: owner.id, exp: expiry })).toString("base64url"), "disposable-signature"].join(".");
    let callback = "";
    let exchanges = 0;
    await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" };
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
      if (url.pathname === "/auth/v1/otp") {
        expect(request.postDataJSON()).toMatchObject({ email: owner.email, code_challenge_method: "s256" });
        callback = url.searchParams.get("redirect_to")!;
        return route.fulfill({ headers, json: {} });
      }
      if (url.pathname === "/auth/v1/token") {
        expect(url.searchParams.get("grant_type")).toBe("pkce");
        expect(request.postDataJSON()).toMatchObject({ auth_code: "warm-email-code", code_verifier: expect.any(String) });
        exchanges += 1;
        return route.fulfill({ headers, json: { user: owner, access_token: access, refresh_token: "disposable-refresh", expires_in: 3600, expires_at: expiry, token_type: "bearer" } });
      }
      return route.fulfill({ headers, json: url.pathname === "/auth/v1/user" ? owner : {} });
    });
    await page.goto("https://pubmaxxing.com/login?next=/u/you");
    await expect(page.locator('input[type="email"]')).toBeEnabled();
    await page.locator('input[type="email"]').fill(owner.email);
    await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
    await expect(page.getByRole("button", { name: "Link sent", exact: true })).toBeVisible();
    await expect.poll(() => callback).not.toBe("");
    const relayUrl = new URL(callback);
    expect(relayUrl.searchParams.get("native")).toBe("ios-email-pkce");
    relayUrl.searchParams.set("code", "warm-email-code");
    // The relay hands an email link to the app only when an iPhone opens it.
    const relay = await page.request.get(new URL(relayUrl.pathname + relayUrl.search, baseURL).toString(), {
      maxRedirects: 0, headers: { "user-agent": IPHONE_USER_AGENT },
    });
    expect(relay.status()).toBe(307);
    const returned = relay.headers().location;
    await expect.poll(() => page.evaluate(() => (window as unknown as { nativeEmailFixture: { count: () => number } }).nativeEmailFixture.count())).toBeGreaterThan(0);
    await page.evaluate((url) => (window as unknown as { nativeEmailFixture: { deliver: (url: string) => void } }).nativeEmailFixture.deliver(url), returned);
    await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), AUTH_STORAGE_KEY);
    expect((await stored())?.user.id).toBe(owner.id);
    expect(exchanges).toBe(1);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".profileHandle")).toContainText(`@${handle}`);
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
    expect((await stored())?.user.id).toBe(owner.id);
    const you = page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "You", exact: true });
    await expect(you).toHaveAttribute("href", `/u/${handle}`);
    expect(await you.evaluate((anchor: HTMLAnchorElement) => anchor.href)).toBe(`https://pubmaxxing.com/u/${handle}`);
    await page.screenshot({ path: testInfo.outputPath(`restored-you-${theme}.png`) });
    // The first activation after reload must retain the current owner's profile.
    await you.click();
    await expect(page).toHaveURL(new RegExp(`/u/${handle}$`));
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
    expect(exchanges).toBe(1);
  });
}
