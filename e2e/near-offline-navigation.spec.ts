import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "allow", storageState: { cookies: [], origins: [] } });

const shellCache = "pubmax-sw-shell-v2-local";

async function prepareOfflineNavigation(page: Page): Promise<void> {
  await page.goto("/offline.html");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register(
      "/sw.js?v=local&cache-policy=plan-preview-safe-v2",
      { updateViaCache: "none" },
    );
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() =>
    navigator.serviceWorker.controller?.scriptURL ?? "",
  )).toContain("/sw.js?v=local");
  await expect.poll(() => page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return Promise.all(["/", "/map", "/offline.html"].map(async (path) =>
      Boolean(await cache.match(path)),
    ));
  }, shellCache), { timeout: 60_000 }).toEqual([true, true, true]);
}

// Oracle: nearby navigation requires a connection and must explain its absence.
// Real cached homepage and nearby documents must not answer under /near offline.
for (const path of ["/near", "/near?patch=soho&drink=guinness&locate=1"]) {
  test(`offline ${path} explains the missing connection despite cached pages`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    await prepareOfflineNavigation(page);
    await page.evaluate(async ({ name, path }) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Nearby setup failed: ${response.status}`);
      await (await caches.open(name)).put(path, response);
    }, { name: shellCache, path });
    await context.setOffline(true);
    try {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.fromServiceWorker()).toBe(true);
      expect(new URL(page.url()).pathname).toBe("/near");
      expect(new URL(page.url()).search).toBe(new URL(path, "https://example.test").search);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "You're offline. The map remembers what it can.",
      );
      await expect(page.getByText("live prices and last-train times need a connection", { exact: false })).toBeVisible();
      await page.screenshot({ path: info.outputPath("near-offline.png"), fullPage: true });
      await info.attach("offline-nearby", { path: info.outputPath("near-offline.png"), contentType: "image/png" });
      await page.getByRole("link", { name: "Back to the map" }).click();
      await expect(page).toHaveURL(/\/map$/);
      await expect(page).not.toHaveTitle("You're offline. PUBMAXX");
    } finally {
      await context.setOffline(false);
    }
  });
}

test("offline nearby returns an explicit 503 when its explanation is not cached", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await prepareOfflineNavigation(page);
  await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("pubmax-sw-shell-v2-")) {
        await (await caches.open(name)).delete("/offline.html", { ignoreSearch: true });
      }
    }
  });
  await context.setOffline(true);
  try {
    const response = await page.goto("/near?patch=soho");
    expect(response?.status()).toBe(503);
    expect(response?.fromServiceWorker()).toBe(true);
    expect(response?.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response?.headers().location).toBeUndefined();
    await expect(page.locator("body")).toHaveText("You're offline and nothing is cached yet.");
    await page.screenshot({ path: info.outputPath("near-no-cache.png"), fullPage: true });
    await info.attach("missing-offline-document", { path: info.outputPath("near-no-cache.png"), contentType: "image/png" });
  } finally {
    await context.setOffline(false);
  }
});

test("nearby recovers to its live page when the connection returns", async ({ page, context }, info) => {
  test.setTimeout(90_000);
  await prepareOfflineNavigation(page);
  await context.setOffline(true);
  await page.goto("/near?patch=soho");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("You're offline.");
  await context.setOffline(false);
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Find my pint/);
  await expect(page.getByRole("heading", { name: "Cheapest listed around Soho" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change area", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("near-online.png"), fullPage: true });
  await info.attach("nearby-reconnected", { path: info.outputPath("near-online.png"), contentType: "image/png" });
});
