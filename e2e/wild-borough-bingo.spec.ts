import { expect, test, type Page, type Route } from "@playwright/test";
import {
  ACCOUNTS,
  accessJwt,
  installAuthDoubles,
  readDeviceAccounts,
  readDeviceIdentity,
  seedSignedIn,
  switchRememberedAccount,
  type Stub,
} from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

// The browser renders the real profile and card. Auth, Been, and the slim index
// are fixture-backed. These tests do not prove live account or database access.
test.use({ serviceWorkers: "block" });

const LAMB = { venueId: "venue-test-lamb", venueName: "The Lamb", lastDate: "", sources: ["been_here"] };
const UNKNOWN = { venueId: "venue-test-unknown", venueName: "Unknown pub", lastDate: "", sources: ["been_here"] };
const CARD = ".boroughBingoPreview";

async function installProfileDoubles(page: Page) {
  let ownerReads = 0;
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) => route.fulfill({
    json: {
      profile: { id: ACCOUNTS.A.id, handle: ACCOUNTS.A.handle, displayName: ACCOUNTS.A.name, createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-01T12:00:00Z" },
      socialLinks: [], counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false,
    },
  }));
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}/been`, async (route) => {
    const bearer = await route.request().headerValue("authorization");
    const owner = bearer === "Bearer pubmaxx-e2e-access-token-A" || bearer === `Bearer ${accessJwt(ACCOUNTS.A)}`;
    if (owner) ownerReads += 1;
    await route.fulfill({ json: { access: owner ? "full" : "shared", status: "ready", count: owner ? 2 : 0, venues: owner ? [LAMB, UNKNOWN] : [], wantToTryCount: null, cover: null } });
  });
  return () => ownerReads;
}

function slimFixture(revision: unknown) {
  return { revision, rows: [
    { id: LAMB.venueId, name: LAMB.venueName, lat: 51.52, lng: -0.12, borough: "Camden", cheapestPrice: null },
    { id: UNKNOWN.venueId, name: UNKNOWN.venueName, lat: 51.51, lng: -0.11, borough: "Not a London borough", cheapestPrice: null },
  ] };
}

async function answerSlim(route: Route, wait?: Promise<void>) {
  const response = await route.fetch();
  const body = await response.json() as { revision?: unknown };
  if (wait) await wait;
  await route.fulfill({ response, json: slimFixture(body.revision) });
}

async function previewOn(page: Page, enabled: boolean) {
  await page.addInitScript((on) => {
    localStorage.setItem("pubmax-wild", "1");
    if (on) localStorage.setItem("pubmax-wild-night-preview", "borough-bingo");
    else localStorage.removeItem("pubmax-wild-night-preview");
  }, enabled);
}

async function seedBoth(page: Page, stub: Stub) {
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await stub.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);
  await stub.signedInAs("A");
}

test("fixture-backed visitor and signed-out views do not show the private card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installAuthDoubles(page);
  await installProfileDoubles(page);
  await previewOn(page, true);
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect(page.locator(".profileIdentity")).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(0);
  await seedSignedIn(page, "B");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.locator(CARD)).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`fixture-backed owner sees the card at 390px in ${theme} with 200% root text`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await storeThemeChoice(page, theme);
    await installAuthDoubles(page);
    const ownerReads = await installProfileDoubles(page);
    await previewOn(page, false);
    let indexReads = 0;
    await page.route("**/data/venues_slim.json*", async (route) => { indexReads += 1; await answerSlim(route); });
    await seedSignedIn(page, "A");
    await page.goto(`/u/${ACCOUNTS.A.handle}`);
    await expect.poll(ownerReads).toBeGreaterThan(0);
    await expect(page.locator("#passport-been")).toBeVisible();
    await expect(page.locator(CARD)).toHaveCount(0);
    expect(indexReads).toBe(0);
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await expect(page.locator("#borough-bingo")).toBeVisible();
    const normalPath = testInfo.outputPath(`borough-normal-fixture-${theme}-390-200pct.png`);
    await page.locator("#borough-bingo").screenshot({ path: normalPath });
    await testInfo.attach(`normal-${theme}-200pct-fixture`, { path: normalPath, contentType: "image/png" });
    await page.getByLabel("Night preview").selectOption("borough-bingo");
    const card = page.locator(CARD);
    await expect(card).toBeVisible();
    await expect(page.locator("#borough-bingo")).toHaveCount(0);
    await expect(page.locator("#borough-bingo-preview-title")).toHaveCount(1);
    expect(indexReads).toBeGreaterThan(0);
    await expect(card.locator("li")).toHaveCount(33);
    await expect(card.locator("li").filter({ hasText: "City of London" })).toContainText("Free square");
    const camden = card.getByRole("link", { name: /Camden.*The Lamb/ });
    await expect(camden).toHaveAttribute("href", /sel=venue-test-lamb/);
    await expect(card.getByText("Unknown pub")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const previewPath = testInfo.outputPath(`borough-bingo-fixture-${theme}-390-200pct.png`);
    await card.screenshot({ path: previewPath });
    await testInfo.attach(`preview-${theme}-200pct-fixture`, { path: previewPath, contentType: "image/png" });
    await card.locator("h2").scrollIntoViewIfNeeded();
    const viewportPath = testInfo.outputPath(`borough-preview-viewport-fixture-${theme}-200pct.png`);
    await page.screenshot({ path: viewportPath });
    await testInfo.attach(`preview-${theme}-viewport-200pct-fixture`, { path: viewportPath, contentType: "image/png" });
    const lastSquare = card.locator("li").last();
    await lastSquare.scrollIntoViewIfNeeded();
    await expect.poll(async () => {
      const square = await lastSquare.boundingBox();
      const nav = await page.locator(".mobileTabBar").boundingBox();
      return square !== null && (nav === null || square.y + square.height <= nav.y);
    }).toBe(true);
    const lastRowPath = testInfo.outputPath(`borough-preview-last-row-fixture-${theme}-200pct.png`);
    await page.screenshot({ path: lastRowPath });
    await testInfo.attach(`preview-${theme}-last-row-200pct-fixture`, { path: lastRowPath, contentType: "image/png" });
    await page.getByLabel("Night preview").selectOption("off");
    await expect(card).toHaveCount(0);
    await expect(page.locator("#borough-bingo")).toBeVisible();
    await expect(page.locator("#borough-bingo-title")).toHaveCount(1);
    await expect(page.locator("#borough-bingo-preview-title")).toHaveCount(0);
    await page.getByLabel("Night preview").selectOption("borough-bingo");
    const link = page.locator(CARD).getByRole("link", { name: /Camden.*The Lamb/ });
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/map\?sel=venue-test-lamb/);
  });
}

test("fixture-backed account switch clears the card before a held index reply", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const stub = await installAuthDoubles(page);
  await installProfileDoubles(page);
  await previewOn(page, true);
  await seedBoth(page, stub);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let indexReads = 0;
  await page.route("**/data/venues_slim.json*", async (route) => { indexReads += 1; await answerSlim(route, held); });
  try {
    await page.goto(`/u/${ACCOUNTS.A.handle}`);
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
    await expect.poll(() => indexReads).toBeGreaterThan(0);
    await expect(page.getByText("Loading London boroughs…")).toBeVisible();
    await switchRememberedAccount(page, "A", "B");
    await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
    await expect(page.getByText("Loading London boroughs…")).toHaveCount(0);
    const indexResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/data/venues_slim.json");
    release();
    await indexResponse;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator(CARD)).toHaveCount(0);
  } finally {
    release();
  }
});
