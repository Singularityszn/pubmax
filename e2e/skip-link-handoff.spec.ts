import { expect, test } from "@playwright/test";

test("skip link keeps focus when the lazy map replaces its loading landmark", async ({ page }) => {
  let releaseMap!: () => void;
  let mapRequested!: () => void;
  const heldMap = new Promise<void>((resolve) => { releaseMap = resolve; });
  const requestedMap = new Promise<void>((resolve) => { mapRequested = resolve; });
  // Identify the Map component's chunk by its accessible region text rather
  // than a build-specific hash. Other application scripts can hydrate normally.
  await page.route("**/_next/static/chunks/*.js*", async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("Interactive pub map of")) {
      mapRequested();
      await heldMap;
    }
    await route.fulfill({ response, body });
  });
  try {
    await page.goto("/map", { waitUntil: "commit" });
    await requestedMap;
    const loadingMain = page.locator("main#main.mapSkeleton");
    await expect(loadingMain).toBeVisible();
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await skipLink.focus();
    await skipLink.click();
    await expect(loadingMain).toBeFocused();
    releaseMap();
    await expect(page.locator("main#main.appShell")).toBeFocused();
  } finally {
    releaseMap();
  }
});

test("native skip link focuses the loading landmark before hydration", async ({ page }) => {
  let releaseScripts!: () => void;
  const heldScripts = new Promise<void>((resolve) => { releaseScripts = resolve; });
  await page.route("**/_next/static/chunks/*.js*", async (route) => {
    await heldScripts;
    await route.continue();
  });
  try {
    await page.goto("/map", { waitUntil: "commit" });
    const loadingMain = page.locator("main#main.mapSkeleton");
    await expect(loadingMain).toBeVisible();
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    await skipLink.focus();
    await skipLink.click();
    await expect(loadingMain).toBeFocused();
    releaseScripts();
    await expect(page.locator("main#main.appShell")).toBeFocused();
  } finally {
    releaseScripts();
  }
});
