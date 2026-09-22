import { expect, test } from "@playwright/test";
import { ACCOUNTS, installAuthDoubles } from "./helpers/authDoubles";

// Browser native-platform double: exercises the real entry scripts and
// AuthProvider, not a Capacitor device or a real identity provider.
for (const returning of [false, true]) {
  for (const callback of ["tokens", "provider error"] as const) {
    test(`native root ${callback}, returning=${returning}`, async ({ page }) => {
      await installAuthDoubles(page);
      const persisted: unknown[] = [];
      const providerBearers: string[] = [];
      page.on("request", (request) => {
        if (request.url().startsWith("https://pubmaxx-e2e.supabase.co/auth/v1/user")) {
          providerBearers.push(request.headers().authorization ?? "");
        }
      });
      await page.route("**/api/auth/session", async (route) => {
        const body = route.request().method() === "POST"
          ? route.request().postDataJSON() : null;
        if (body?.action === "persist") persisted.push(body);
        await route.fulfill({ json: { ok: true, session: null } });
      });
      await page.addInitScript((returning) => {
        Object.defineProperty(window, "CapacitorCustomPlatform", {
          configurable: true, writable: true, value: { name: "ios", plugins: {} },
        });
        Object.defineProperty(window, "Capacitor", {
          configurable: true, writable: true,
          value: { isNativePlatform: () => true, getPlatform: () => "ios" },
        });
        if (returning) localStorage.setItem("pubmax:nativeFirstRun:routed:v1", "1");
      }, returning);
      const jwt = [
        { alg: "HS256", typ: "JWT" },
        { sub: ACCOUNTS.A.id, email: ACCOUNTS.A.email, exp: Math.floor(Date.now() / 1000) + 3600 },
      ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
        .concat(Buffer.from("synthetic-signature").toString("base64url")).join(".");
      const entry = callback === "tokens"
        ? `/#access_token=${jwt}&refresh_token=${ACCOUNTS.A.refreshToken}&type=magiclink`
        : "/?_authCallback=1&authError=1";
      await page.goto(entry);
      if (callback === "tokens") {
        await expect(page.getByText(`Signed in as ${ACCOUNTS.A.email}.`, { exact: true })).toBeVisible();
        expect(providerBearers).toContain(`Bearer ${jwt}`);
        await expect.poll(() => persisted.length).toBeGreaterThan(0);
      } else {
        await expect(page.getByRole("alert").filter({ hasText: "Sign-in could not be completed." })).toBeVisible();
        expect(persisted).toHaveLength(0);
      }
      await expect(page).toHaveURL(/\/$/);
      expect(await page.evaluate(() => sessionStorage.getItem("pubmax:entryDecision:consumed:v1"))).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem("pubmax:nativeFirstRun:routed:v1"))).toBe(returning ? "1" : null);
    });
  }
}
