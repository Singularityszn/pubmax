import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/node_modules/@playwright/test";

import { installAuthDoubles, seedSignedIn } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/helpers/authDoubles";
import { installDeterministicMapBasemap } from "/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/e2e/helpers/mapNetworkFixtures";

test.use({ serviceWorkers: "block" });
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await installAuthDoubles(page);
  await installDeterministicMapBasemap(page);
});

const venueSheet = (page: Page) => page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
const contributeParam = (page: Page) => new URL(page.url()).searchParams.get("contribute");

async function openCreateLogAPrice(page: Page) {
  await expect(async () => {
    await page.getByTestId("create-fab").click();
    await expect(page.locator(".createFabMenu").getByRole("link", { name: "Log a price" })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.locator(".createFabMenu").getByRole("link", { name: "Log a price" }).click();
  await expect(page.getByText("Pick a pub to log a price", { exact: true })).toBeVisible({ timeout: 45_000 });
}

test("a consumed price intent retires on Home and Create starts another contribution", async ({ page }) => {
  await seedSignedIn(page, "A");
  await page.goto("/map/manchester?drink=wine&contribute=price");
  await expect(page.locator(".logIntentNearbyBtn").first()).toBeVisible({ timeout: 45_000 });
  await page.locator(".logIntentNearbyBtn").first().click();
  const price = page.getByRole("textbox", { name: /Price of a wine at/ });
  await expect(price).toBeVisible();
  await expect.poll(() => contributeParam(page)).toBeNull();

  await venueSheet(page).locator(".surfaceNavHome").click();
  await expect(price).toBeHidden();
  await expect.poll(() => contributeParam(page)).toBeNull();
  await expect(page.getByText(/Pick a pub to log a/)).toHaveCount(0);

  await openCreateLogAPrice(page);
  await page.locator(".logIntentNearbyBtn").first().click();
  await expect(price).toBeVisible();
  await expect.poll(() => contributeParam(page)).toBeNull();
});

test("an anonymous price intent stays with the first pub and never gates another", async ({ page }) => {
  await page.goto("/map/manchester?drink=wine");
  await openCreateLogAPrice(page);
  const nearby = page.locator(".logIntentNearbyBtn");
  await expect(nearby.nth(1)).toBeVisible();
  const otherVenue = (await nearby.nth(1).locator("span").first().textContent())?.trim();
  expect(otherVenue).toBeTruthy();
  await nearby.first().click();

  const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });
  await expect(gate).toBeVisible();
  expect(contributeParam(page)).toBe("price");

  await venueSheet(page).locator(".surfaceNavHome").click();
  await expect(gate).toBeHidden();
  await page.getByRole("button", { name: "Search the map" }).click();
  await page.locator("#mobileMapSearchInput").fill(otherVenue!);
  await page.getByRole("option", { name: new RegExp(otherVenue!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first().click();

  await expect(venueSheet(page)).toContainText(otherVenue!);
  await expect(page.getByRole("button", { name: "Log a wine price", exact: true })).toBeVisible();
  await expect(gate).toHaveCount(0);
  await expect.poll(() => contributeParam(page)).toBeNull();
});

test("an anonymous price intent retires when a client navigation opens another pub over the gate", async ({ page }) => {
  await page.goto("/map/manchester?drink=wine&contribute=price");
  const nearby = page.locator(".logIntentNearbyBtn");
  await expect(nearby.nth(1)).toBeVisible({ timeout: 45_000 });
  // Learn the second pub's id from its hover prefetch, refused so its detail
  // is not warm and the drawer reopens as a fresh inspector for it.
  const otherDetail = page.waitForRequest((request) => request.url().includes("/api/venue/"));
  await page.route("**/api/venue/**", (route) => route.abort());
  await nearby.nth(1).hover();
  const otherVenueId = decodeURIComponent(new URL((await otherDetail).url()).pathname.split("/").at(-1)!);
  await page.unroute("**/api/venue/**");
  await page.route(`**/api/venue/${encodeURIComponent(otherVenueId)}`, (route) => route.abort());
  await nearby.first().click();

  const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });
  await expect(gate).toBeVisible();
  const gatedVenueId = new URL(page.url()).searchParams.get("sel");
  expect(gatedVenueId).toBeTruthy();
  expect(gatedVenueId).not.toBe(otherVenueId);
  expect(contributeParam(page)).toBe("price");

  await page.unroute(`**/api/venue/${encodeURIComponent(otherVenueId)}`);
  // The same client navigation a "See on map" link makes: the map stays
  // mounted, keeps the live URL's params and selects the linked pub.
  await page.evaluate((venueId) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sel", venueId);
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(`${url.pathname}${url.search}`);
  }, otherVenueId);

  await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(otherVenueId);
  await expect(page.getByRole("button", { name: "Log a wine price", exact: true })).toBeVisible();
  await expect(gate).toHaveCount(0);
  await expect.poll(() => contributeParam(page)).toBeNull();
});

test("Back from a gated pub returns to the price picker, which still opens another pub's price door", async ({ page }) => {
  await page.goto("/map/manchester?drink=wine");
  await openCreateLogAPrice(page);
  const nearby = page.locator(".logIntentNearbyBtn");
  await expect(nearby.nth(1)).toBeVisible();
  const firstVenue = (await nearby.first().locator("span").first().textContent())?.trim();
  expect(firstVenue).toBeTruthy();
  const picker = page.getByText("Pick a pub to log a price", { exact: true });
  const gate = venueSheet(page).getByRole("heading", { name: "Sign in to add a price" });

  await nearby.first().click();
  await expect(gate).toBeVisible();
  await expect(venueSheet(page)).toContainText(firstVenue!);

  await venueSheet(page).getByRole("button", { name: "Back to Choose a pub" }).click();
  await expect(venueSheet(page)).toHaveCount(0);
  await expect(picker).toBeVisible();
  expect(contributeParam(page)).toBe("price");

  // The picker re-sorts around the map; take any pub but the first one.
  const another = nearby.filter({ hasNotText: firstVenue! }).first();
  const secondVenue = (await another.locator("span").first().textContent())?.trim();
  expect(secondVenue).toBeTruthy();
  await another.click();
  await expect(gate).toBeVisible();
  await expect(venueSheet(page)).toContainText(secondVenue!);
  expect(contributeParam(page)).toBe("price");

  await page.goBack();
  await expect(venueSheet(page)).toHaveCount(0);
  await expect(picker).toBeVisible();
  expect(contributeParam(page)).toBe("price");

  const third = nearby.filter({ hasNotText: secondVenue! }).first();
  const thirdVenue = (await third.locator("span").first().textContent())?.trim();
  expect(thirdVenue).toBeTruthy();
  await third.click();
  await expect(gate).toBeVisible();
  await expect(venueSheet(page)).toContainText(thirdVenue!);

  await venueSheet(page).locator(".surfaceNavHome").click();
  await expect(venueSheet(page)).toHaveCount(0);
  await expect(page.getByText(/Pick a pub to log a/)).toHaveCount(0);
  await expect.poll(() => contributeParam(page)).toBeNull();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const journal: unknown[] = [];
    (window as any).__priceHistoryJournal = journal;
    const record = (kind: string, args?: unknown) => journal.push({ kind, args, url: location.href, length: history.length, state: history.state, time: performance.now() });
    for (const method of ["pushState", "replaceState", "go", "back"] as const) {
      const original = history[method].bind(history) as any;
      (history as any)[method] = (...args: unknown[]) => { record(method + ":before", args); const result = original(...args); record(method + ":after"); return result; };
    }
    window.addEventListener("popstate", event => record("popstate", event.state));
    document.addEventListener("click", event => record("click", (event.target as HTMLElement)?.closest("button,a")?.textContent?.trim()), true);
    record("init");
  });
});
test.afterEach(async ({ page }, info) => {
  const journal = await page.evaluate(() => (window as any).__priceHistoryJournal).catch(() => null);
  writeFileSync("/tmp/pubmaxx-r46-native-journal/" + info.title.replace(/[^a-z0-9]+/gi, "-").slice(0,80) + ".json", JSON.stringify({ title: info.title, status: info.status, errors: info.errors, journal }, null, 2));
});
