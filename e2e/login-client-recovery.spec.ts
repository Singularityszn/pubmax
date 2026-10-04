import { expect, test } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}px sign-in recovers a failed auth client through Try again`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Sign-in client recovery needs the configured production baseURL.");
    const origin = new URL(baseURL).origin;
    await page.setViewportSize(viewport);
    await installAuthDoubles(page);

    let documents = 0;
    const sdkScripts: Array<{ document: number; url: string; blocked: boolean }> = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documents += 1;
      }
    });
    // Deployment-skew auto-reload must not stand in for the person's retry.
    await page.route("**/api/version", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    }));
    // Identify the real lazy SDK by its locked-package constructor messages.
    // Never guess a hashed asset URL or abort the eager auth/page component.
    await page.route("**/_next/static/chunks/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.resourceType() !== "script" || url.origin !== origin || !url.pathname.endsWith(".js")) {
        await route.fallback();
        return;
      }
      const requestDocument = documents;
      const response = await route.fetch();
      const source = await response.text();
      if (source.includes("supabaseKey is required.") && source.includes("Invalid supabaseUrl")) {
        const blocked = requestDocument === 1;
        sdkScripts.push({ document: requestDocument, url: request.url(), blocked });
        if (blocked) {
          await route.abort("failed");
          return;
        }
      }
      await route.fulfill({ response });
    });

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect.poll(() => sdkScripts.filter((script) => script.blocked).length).toBeGreaterThan(0);
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Sign-in is temporarily unavailable", exact: true })).toBeVisible({ timeout: 30_000 });
    const alert = main.getByRole("alert");
    await expect(alert).toContainText("Try again to load sign-in");
    await expect(main.locator('input[type="email"]')).toHaveCount(0);
    await expect(main.getByRole("link", { name: "Browse without signing in", exact: true })).toHaveAttribute("href", "/map");
    expect(documents).toBe(1);

    const retry = alert.getByRole("button", { name: "Try again", exact: true });
    await expect(retry).toBeEnabled();
    const navigation = page.waitForEvent("request", {
      predicate: (request) => request.isNavigationRequest() && request.frame() === page.mainFrame(),
    });
    await Promise.all([navigation, retry.click()]);

    const email = main.getByRole("textbox", { name: "Sign in with your email", exact: true });
    await expect(email).toBeVisible({ timeout: 30_000 });
    await expect(email).toBeEnabled();
    await email.fill("guest@example.test");
    await expect(email).toHaveValue("guest@example.test");
    await expect(main.getByRole("button", { name: "Email me a sign-in link", exact: true })).toBeEnabled();
    await expect(main.getByRole("heading", { name: "Sign-in is temporarily unavailable", exact: true })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Try again", exact: true })).toHaveCount(0);
    expect(documents).toBe(2);
    // The server-rendered door is usable before the lazy SDK lands, so wait for it.
    await expect.poll(() => sdkScripts.some((script) => script.document === 2 && !script.blocked)).toBe(true);
    await page.screenshot({ path: test.info().outputPath("login-client-recovered.png") });
  });
}
