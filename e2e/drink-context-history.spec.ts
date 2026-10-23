import { expect, test, type Page } from "@playwright/test";
import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { desktopPlannerDrawer } from "./helpers/mapSurfaceDrawers";

test.use({ serviceWorkers: "block", actionTimeout: 10_000 });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await installDeterministicMapBasemap(page);
});

async function openPlanner(page: Page) {
  await expect(async () => {
    await page.getByRole("button", { name: "Plan an outing", exact: true }).click();
    await expect(desktopPlannerDrawer(page)).toHaveAttribute("aria-hidden", "false", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

for (const direction of ["back", "home", "forward"] as const) {
  test(`reversed curated stops survive immediate ${direction} and a browser reload`, async ({ page }, testInfo) => {
    await page.goto("/map?crawl=victorian-soho");
    await expect.poll(() => new URL(page.url()).searchParams.get("pubs")?.split(",").length).toBe(5);
    const originalIds = new URL(page.url()).searchParams.get("pubs")!.split(",");
    await openPlanner(page);
    const planner = desktopPlannerDrawer(page);
    const names = planner.locator(".routeList > li > button strong");
    await expect(names).toHaveCount(5);
    const originalNames = await names.allTextContents();
    await names.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("original-stops.png") });
    await planner.getByRole("button", { name: "Reverse route", exact: true }).scrollIntoViewIfNeeded();
    const homeBox = await planner.locator(".surfaceNavHome").boundingBox();
    expect(homeBox).not.toBeNull();
    const reverseBox = await planner.getByRole("button", { name: "Reverse route", exact: true }).boundingBox();
    expect(reverseBox).not.toBeNull();
    // Hold the debounce so slow browser IPC cannot turn this into a post-flush test.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await page.evaluate(() => {
      const reverse = Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Reverse route");
      reverse?.addEventListener("click", () => {
        sessionStorage.setItem("qa-reverse-at", String(performance.now()));
      }, { once: true });
      window.addEventListener("popstate", () => {
        sessionStorage.setItem("qa-pop-at", String(performance.now()));
      }, { once: true });
    });
    await page.mouse.click(reverseBox!.x + reverseBox!.width / 2, reverseBox!.y + reverseBox!.height / 2);
    await page.clock.runFor(1);
    if (direction === "home") await page.mouse.click(homeBox!.x + homeBox!.width / 2, homeBox!.y + homeBox!.height / 2);
    else await page.goBack();
    const elapsed = await page.evaluate(() =>
      Number(sessionStorage.getItem("qa-pop-at")) - Number(sessionStorage.getItem("qa-reverse-at")),
    );
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(300);
    if (direction === "forward") await page.goForward();
    await expect.poll(() => new URL(page.url()).searchParams.get("crawl")).toBeNull();
    expect(new URL(page.url()).searchParams.get("pubs")?.split(",")).toEqual([...originalIds].reverse());
    await testInfo.attach("landed-url", { body: JSON.stringify({ direction, elapsedMs: elapsed, url: page.url() }), contentType: "application/json" });
    await page.clock.resume();
    await page.reload();
    await openPlanner(page);
    await expect(names).toHaveText([...originalNames].reverse());
    expect(new URL(page.url()).searchParams.get("crawl")).toBeNull();
    await names.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("reloaded-reversed-stops.png") });
  });
}

test("1440px canonical Bristol contribution resets an empty query into a cocktail form", async ({ page }, testInfo) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.goto("/map/bristol?drink=cocktail&q=zzzznonexistentpub&contribute=price");
  await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: testInfo.outputPath("desktop-picker.png") });
  await page.getByRole("button", { name: "Show all pubs", exact: true }).click();
  await expect(page.locator(".logIntentNearbyBtn").first()).toContainText("Cocktail price unknown");
  const nearbyCocktail = page.locator(".logIntentNearbyBtn").first();
  // A picker re-sort between press and release drops the tap, so only a
  // dropped tap is retried (e2e/design-review-followups.spec.ts).
  await expect(async () => {
    if (await nearbyCocktail.isVisible()) await nearbyCocktail.click({ timeout: 2_000 });
    await expect(page.getByRole("textbox", { name: /Price of a cocktail at/ })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  expect(new URL(page.url()).pathname).toBe("/map/bristol");
  expect(new URL(page.url()).searchParams.get("drink")).toBe("cocktail");
  await page.screenshot({ path: testInfo.outputPath("desktop-cocktail-form.png") });
});

test("390px Drink retains Wine through Back Forward Home and reload", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map/manchester");
  const drinkButton = page.getByRole("button", { name: /^Drink shown on the map:/ });
  const drinkSheet = page.locator('.mobileSheetPortal[data-sheet-kind="drink"]');
  await expect(async () => {
    await drinkButton.click();
    await expect(drinkSheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await drinkSheet.getByRole("button", { name: "Wine", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("drink")).toBe("wine");
  await page.goBack();
  await expect(drinkSheet).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
  await page.goForward();
  await expect(drinkSheet).toBeVisible();
  await expect(drinkSheet.getByRole("button", { name: "Wine", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
  await page.screenshot({ path: testInfo.outputPath("mobile-wine-forward.png") });
  await drinkSheet.locator(".surfaceNavHome").click();
  await expect(drinkSheet).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/map/manchester");
  expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
  await page.reload();
  await expect(drinkButton).toContainText("Wine");
  await page.screenshot({ path: testInfo.outputPath("mobile-wine-reload.png") });
});

test("canonical city pathname wins over obsolete city query during a drink edit", async ({ page }, testInfo) => {
  await page.goto("/map/bristol?city=manchester&drink=wine");
  await expect(page.locator("#mapSearchInput")).toHaveAttribute("placeholder", /Bristol/);
  await page.getByRole("button", { name: "Drink: Wine", exact: true }).click();
  await page.getByRole("group", { name: "Drink prices shown on the map" }).getByRole("button", { name: "Cocktails", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("drink")).toBe("cocktail");
  expect(new URL(page.url()).searchParams.has("city")).toBe(false);
  expect(new URL(page.url()).pathname).toBe("/map/bristol");
  await page.reload();
  await expect(page.locator("#mapSearchInput")).toHaveAttribute("placeholder", /Bristol/);
  await expect(page.getByRole("button", { name: "Drink: Cocktails", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("canonical-bristol-reload.png") });
});

test("390px price venue survives repeated ForwardBack without adding history entries", async ({ page }, testInfo) => {
  await installAuthDoubles(page);
  await seedSignedIn(page, "A");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/map/manchester?drink=wine&contribute=price");
  const nearby = page.locator(".logIntentNearbyBtn").first();
  await expect(nearby).toBeVisible({ timeout: 45_000 });
  await expect(nearby).toContainText("Wine price unknown");
  const price = page.getByRole("textbox", { name: /Price of a wine at/ });
  // A picker re-sort between press and release drops the tap, so only a
  // dropped tap is retried (e2e/design-review-followups.spec.ts).
  await expect(async () => {
    if (await nearby.isVisible()) await nearby.click({ timeout: 2_000 });
    await expect(price).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  const venueId = new URL(page.url()).searchParams.get("sel");
  expect(venueId).toBeTruthy();
  const historyLength = await page.evaluate(() => history.length);
  for (let iteration = 0; iteration < 2; iteration += 1) {
    await page.goBack();
    await expect(price).toBeHidden();
    await page.goForward();
    // Back dismisses the contribution form; Forward restores the venue and its
    // category-specific price door, which the reader can open again.
    await page.getByRole("button", { name: "Log a wine price", exact: true }).click();
    await expect(price).toBeVisible();
    expect(new URL(page.url()).searchParams.get("sel")).toBe(venueId);
    expect(new URL(page.url()).searchParams.get("drink")).toBe("wine");
    expect(new URL(page.url()).pathname).toBe("/map/manchester");
    expect(await page.evaluate(() => history.length)).toBe(historyLength);
  }
  await page.screenshot({ path: testInfo.outputPath("mobile-price-forward-back.png") });
});
