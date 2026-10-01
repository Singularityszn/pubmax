import { expect, test } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

test.use({
  storageState: { cookies: [], origins: [] },
  serviceWorkers: "block",
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}px account form recovers a failed production chunk through page reload`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    if (!baseURL) throw new Error("Account chunk recovery needs the configured production baseURL.");
    const origin = new URL(baseURL).origin;
    await page.setViewportSize(viewport);
    const stub = await installAuthDoubles(page, { initialSeedOnly: true });
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await seedSignedIn(page, "A");
    stub.setServerHandle(null);

    const events: string[] = [];
    const statusReads: Array<{ document: number; authorization: string | undefined }> = [];
    const formChunks: Array<{ document: number; url: string }> = [];
    const claims: Array<{ body: unknown; authorization: string | undefined }> = [];
    let documents = 0;
    let releaseStatus!: () => void;
    const heldStatus = new Promise<void>((resolve) => { releaseStatus = resolve; });

    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
        documents += 1;
        events.push(`document:${documents}`);
      }
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname === "/api/identity/onboarding" && request.method() === "GET") {
        events.push(`status:${documents}`);
      }
      if (url.origin === origin && request.resourceType() === "script" && url.pathname.startsWith("/_next/static/chunks/")) {
        events.push(`script:${documents}:${request.url()}`);
      }
    });
    await page.route("**/api/identity/onboarding", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        claims.push({
          body: request.postDataJSON(),
          authorization: request.headers().authorization,
        });
        stub.setServerHandle("night_owl");
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ complete: true, handle: "night_owl" }),
        });
        return;
      }
      if (request.method() !== "GET") {
        await route.fallback();
        return;
      }
      statusReads.push({ document: documents, authorization: request.headers().authorization });
      if (statusReads.length === 1) await heldStatus;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ complete: false }),
      });
    });
    await page.route("**/api/identity/handle/availability?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true }),
      });
    });
    // A separate deployment-skew reload must not mask the explicit recovery
    // being proved here. This is the public version route's opaque response.
    await page.route("**/api/version", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    // Discover the real form asset from its exclusive field class. Exhaust
    // runtime network retries in the first document; only navigation permits
    // recovery. Never guess a filename or abort an eager host/auth chunk.
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
      if (source.includes("accountOnboardingHandle")) {
        formChunks.push({ document: requestDocument, url: request.url() });
        if (requestDocument === 1 && statusReads.some((read) => read.document === requestDocument)) {
          await route.abort("failed");
          return;
        }
      }
      await route.fulfill({ response });
    });

    try {
      await page.goto("/today", { waitUntil: "domcontentloaded" });
      await expect.poll(() => statusReads.length).toBe(1);
      expect(documents).toBe(1);
      expect(formChunks).toHaveLength(0);
      expect(statusReads[0]?.authorization).toMatch(/^Bearer pubmaxx-e2e-access-token-A$/);
      releaseStatus();

      const dialog = page.getByRole("dialog", { name: "Let's get you in" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("alert")).toContainText("Reload the page to try again");
      await expect(dialog).toBeFocused();
      const firstDocumentChunks = formChunks.filter((chunk) => chunk.document === 1);
      expect(firstDocumentChunks.length).toBeGreaterThanOrEqual(1);
      const formUrl = firstDocumentChunks[0]!.url;
      expect(firstDocumentChunks.every((chunk) => chunk.url === formUrl)).toBe(true);
      const firstInitiations = events.flatMap((event, index) => event === `script:1:${formUrl}` ? [index] : []);
      expect(firstInitiations).toHaveLength(firstDocumentChunks.length);
      expect(firstInitiations.every((index) => index > events.indexOf("status:1"))).toBe(true);
      const frame = await dialog.elementHandle();
      expect(frame).not.toBeNull();

      const retry = dialog.getByRole("button", { name: "Try again", exact: true });
      await page.keyboard.press("Tab");
      await expect(retry).toBeFocused();
      expect(await frame!.evaluate((element) => element.isConnected && element === document.querySelector(".accountOnboarding"))).toBe(true);
      const navigation = page.waitForEvent("request", {
        predicate: (request) => request.isNavigationRequest() && request.frame() === page.mainFrame(),
      });
      await Promise.all([navigation, retry.click()]);

      await expect(dialog.getByLabel("Your handle")).toBeVisible();
      await expect.poll(() => statusReads.length).toBe(2);
      expect(documents).toBe(2);
      expect(formChunks).toHaveLength(firstDocumentChunks.length + 1);
      expect(formChunks.filter((chunk) => chunk.document === 2)).toEqual([{ document: 2, url: formUrl }]);
      expect(statusReads[1]?.document).toBe(2);
      expect(statusReads[1]?.authorization).toBe(statusReads[0]?.authorization);
      expect(events.indexOf("status:2")).toBeLessThan(events.indexOf(`script:2:${formUrl}`));
      await expect(dialog).toBeFocused();
      await expect(dialog.locator('input[autocomplete="name"]')).toHaveValue("");
      await expect(dialog.locator('input[type="date"]')).toHaveValue("");
      await dialog.getByLabel("Your handle").fill("night_owl");
      await expect(dialog.getByText("Handle available.", { exact: true })).toBeVisible();
      const claim = dialog.getByRole("button", { name: "Claim handle", exact: true });
      await expect(claim).toBeEnabled();
      await claim.click();
      await expect(dialog).toHaveCount(0);
      expect(claims).toEqual([{
        body: { handle: "night_owl" },
        authorization: statusReads[0]!.authorization,
      }]);
    } finally {
      releaseStatus();
    }
  });
}
