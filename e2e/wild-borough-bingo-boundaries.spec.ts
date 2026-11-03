import { expect, test, type Page } from "@playwright/test";
import {
  ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn,
  readDeviceAccounts, switchRememberedAccount,
} from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

// Oracle: B6 acceptance requires both switches, an owner/full read, and an
// unambiguous pub ID. Provider and read boundaries are disposable fixtures.
// The profile, index parser, account controls, join, and rendered card are real.
test.use({ serviceWorkers: "block", reducedMotion: "reduce" });
const CARD = ".boroughBingoPreview";
const lamb = { venueId: "venue-1yd70c7", venueName: "The Lamb", lastDate: "", sources: ["been_here"] };
const row = (id: string, borough: string, kind?: string) => ({
  id, name: id === lamb.venueId ? "The Lamb" : "Boundary fixture", borough,
  lat: 51.52, lng: -0.12, cheapestPrice: null, ...(kind ? { kind } : {}),
});

async function setup(page: Page, options: { wild?: boolean; access?: string; been?: object[] } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  const stub = await installAuthDoubles(page);
  await storeThemeChoice(page, "light");
  await page.addInitScript((wild) => {
    localStorage.setItem("pubmax-wild", wild ? "1" : "0");
    localStorage.setItem("pubmax-wild-night-preview", "borough-bingo");
  }, options.wild !== false);
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) => route.fulfill({ json: {
    profile: { id: ACCOUNTS.A.id, handle: ACCOUNTS.A.handle, displayName: ACCOUNTS.A.name, createdAt: "2026-08-01T12:00:00Z", updatedAt: "2026-08-01T12:00:00Z" },
    socialLinks: [], counts: { followers: 0, following: 0 }, viewerFollowing: false, followsViewer: false,
  } }));
  let reads = 0;
  const been = options.been ?? [lamb];
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}/been`, async (route) => {
    reads += 1;
    await route.fulfill({ json: { access: options.access ?? "full", status: "ready", count: been.length, venues: been, wantToTryCount: null, cover: null } });
  });
  return { stub, reads: () => reads };
}

async function owner(page: Page) {
  await seedSignedIn(page, "A");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
}

test("master off preserves the normal owner board without an index join", async ({ page }, info) => {
  const state = await setup(page, { wild: false });
  let indexReads = 0;
  await page.route("**/data/venues_slim.json*", (route) => { indexReads += 1; return route.fulfill({ json: { revision: "local", rows: [row(lamb.venueId, "Camden")] } }); });
  await owner(page);
  await expect.poll(state.reads).toBeGreaterThan(0);
  await expect(page.locator("#borough-bingo")).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(0);
  expect(indexReads).toBe(0);
  await page.locator("#borough-bingo").screenshot({ path: info.outputPath("master-off-normal.png") });
});

test("shared Been rows cannot feed an owner's selected preview", async ({ page }, info) => {
  const state = await setup(page, { access: "shared" });
  let indexReads = 0;
  await page.route("**/data/venues_slim.json*", (route) => { indexReads += 1; return route.fulfill({ json: { revision: "local", rows: [row(lamb.venueId, "Camden")] } }); });
  await owner(page);
  await expect.poll(state.reads).toBeGreaterThan(0);
  await expect(page.locator("#passport-been")).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByText("Loading London boroughs…")).toHaveCount(0);
  expect(indexReads).toBe(0);
  await page.screenshot({ path: info.outputPath("shared-read-private-card-absent.png"), fullPage: true });
});

test("pending owner Been read renders no private placeholder or index request", async ({ page }, info) => {
  await setup(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  let indexReads = 0;
  await page.route("**/data/venues_slim.json*", (route) => { indexReads += 1; return route.fulfill({ json: { revision: "local", rows: [row(lamb.venueId, "Camden")] } }); });
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}/been`, async (route) => {
    requested = true;
    await held;
    await route.fulfill({ json: { access: "full", status: "ready", count: 1, venues: [lamb], wantToTryCount: null, cover: null } });
  });
  try {
    await owner(page);
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator(CARD)).toHaveCount(0);
    await expect(page.getByText("Loading London boroughs…")).toHaveCount(0);
    expect(indexReads).toBe(0);
    release();
    await expect(page.locator(CARD)).toBeVisible();
    await page.locator(CARD).screenshot({ path: info.outputPath("qualified-after-pending.png") });
  } finally { release(); }
});

test("missing IDs, unknown boroughs, cafes, and same-name pubs cannot add marks", async ({ page }, info) => {
  const extra = ["missing", "unknown", "cafe", "same-name"].map((venueId) => ({ ...lamb, venueId }));
  await setup(page, { been: [lamb, ...extra] });
  await page.route("**/data/venues_slim.json*", (route) => route.fulfill({ json: { revision: "local", rows: [
    row(lamb.venueId, "Camden"), row("unknown", "Unknown"), row("cafe", "Hackney", "cafe"),
    { ...row("different-id", "Southwark"), name: "The Lamb" },
  ] } }));
  await owner(page);
  const card = page.locator(CARD);
  await expect(card).toBeVisible();
  await expect(card.locator("li")).toHaveCount(33);
  await expect(card.getByRole("link")).toHaveCount(1);
  await expect(card.getByRole("link")).toHaveAttribute("href", /sel=venue-1yd70c7/);
  await expect(card).not.toContainText(/\b(score|streak|rank|leaderboard)\b|\d+%|\d{4}-\d{2}-\d{2}/i);
  await page.locator(CARD).screenshot({ path: info.outputPath("unsupported-records-unmarked.png") });
});

test("conflicting canonical boroughs for one Been ID leave both squares unmarked", async ({ page }, info) => {
  await setup(page);
  await page.route("**/data/venues_slim.json*", (route) => route.fulfill({ json: { revision: "local", rows: [
    row(lamb.venueId, "Camden"), row(lamb.venueId, "Hackney"),
  ] } }));
  await owner(page);
  const card = page.locator(CARD);
  await expect(card).toBeVisible();
  await card.screenshot({ path: info.outputPath("ambiguous-id-rendered.png") });
  await expect(card.getByRole("link")).toHaveCount(0);
});

test("loaded old-owner marks disappear during a mounted account switch", async ({ page }, info) => {
  const { stub } = await setup(page);
  await seedSignedIn(page, "A");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await stub.signedInAs("B");
  await page.goto("/today");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(2);
  await stub.signedInAs("A");
  await page.route("**/data/venues_slim.json*", (route) => route.fulfill({ json: { revision: "local", rows: [row(lamb.venueId, "Camden")] } }));
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect(page.locator(CARD).getByRole("link", { name: /Camden.*The Lamb/ })).toBeVisible();
  await page.locator(CARD).screenshot({ path: info.outputPath("loaded-before-switch.png") });
  await switchRememberedAccount(page, "A", "B");
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByText("Loading London boroughs…")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("loaded-after-switch-cleared.png"), fullPage: true });
});

test("a canonical pub mark opens its actual pub destination with the keyboard", async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Use the unmodified canonical London index for this journey.
  await owner(page);
  const card = page.locator(CARD);
  const link = card.getByRole("link", { name: /Camden.*The Lamb/ });
  await expect(link).toBeVisible();
  await link.focus();
  await expect(link).toBeFocused();
  await card.screenshot({ path: info.outputPath("actual-pub-keyboard-focus.png") });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/map\?sel=venue-1yd70c7/);
  await expect(page.getByRole("heading", { name: "The Lamb", exact: true }).first()).toBeVisible({ timeout: 25000 });
  await page.screenshot({ path: info.outputPath("actual-lamb-destination.png") });
});

const elevenBoroughs = ["Barnet", "Bexley", "Brent", "Bromley", "Camden", "Croydon", "Ealing", "Enfield", "Greenwich", "Hackney", "Haringey"];

async function stampedGeography(page: Page) {
  await page.route((url) => url.pathname === "/api/pint-drops" && url.searchParams.get("author") === ACCOUNTS.A.handle,
    (route) => route.fulfill({ json: { drops: [], passportAreas: elevenBoroughs } }));
}

test("preview off retains the normal count, board, and voluntary share action", async ({ page }, info) => {
  await setup(page, { wild: false });
  await stampedGeography(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => {
      (window as unknown as { copiedBingoLink: string }).copiedBingoLink = text;
    } }, configurable: true });
  });
  let shareReads = 0;
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}/borough-bingo`, (route) => {
    expect(route.request().method()).toBe("GET");
    shareReads += 1;
    return route.fulfill({ json: { path: "/bingo/fixture-signed-11" } });
  });
  await owner(page);
  const normal = page.locator("#borough-bingo");
  await expect(normal).toContainText("11 of 33 boroughs");
  await expect(normal.locator("li")).toHaveCount(33);
  await expect(normal.locator("li[data-filled]")).toHaveCount(11);
  expect(shareReads).toBe(0);
  await normal.getByRole("button", { name: "Share your card" }).click();
  await expect(normal.getByRole("status")).toHaveText("Link copied.");
  expect(shareReads).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { copiedBingoLink: string }).copiedBingoLink)).toBe(new URL("/bingo/fixture-signed-11", page.url()).href);
  await normal.screenshot({ path: info.outputPath("normal-count-and-share-preserved.png") });
});

test("mutual visitor retains only the normal count while the private preview stays absent", async ({ page }, info) => {
  await setup(page);
  await stampedGeography(page);
  await page.route((url) => url.pathname === `/api/profiles/${ACCOUNTS.A.handle}`, (route) => route.fulfill({ json: {
    profile: { id: ACCOUNTS.A.id, handle: ACCOUNTS.A.handle, displayName: ACCOUNTS.A.name },
    socialLinks: [], counts: { followers: 1, following: 1 }, viewerFollowing: true, followsViewer: true,
  } }));
  await seedSignedIn(page, "B");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.locator(".boroughBingo__count")).toHaveText("Borough bingo: 11 of 33 boroughs");
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.locator("#borough-bingo")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share your card" })).toHaveCount(0);
  await page.locator(".boroughBingo__count").screenshot({ path: info.outputPath("mutual-count-only.png") });
});

test("an unavailable index shows no invented borough marks", async ({ page }, info) => {
  await setup(page);
  await page.route("**/data/venues_slim.json*", (route) => route.fulfill({ status: 503, json: { error: "disposable outage" } }));
  await owner(page);
  const unavailable = page.getByText("London boroughs are unavailable right now.", { exact: true });
  await expect(unavailable).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(0);
  await unavailable.screenshot({ path: info.outputPath("index-unavailable.png") });
});

test("leaving the private card keeps its pending index request usable by map search", async ({ page }, info) => {
  await setup(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let indexReads = 0;
  const failedIndexReads: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/data/venues_slim.json") failedIndexReads.push(request.failure()?.errorText ?? "unknown");
  });
  await page.route("**/data/venues_slim.json*", async (route) => {
    indexReads += 1;
    await held;
    await route.fulfill({ json: { revision: "local", rows: [{ ...row(lamb.venueId, "Camden"), name: "Boundary Reader Pub" }] } });
  });
  try {
    await owner(page);
    await expect(page.getByText("Loading London boroughs…")).toBeVisible();
    await expect.poll(() => indexReads).toBe(1);
    await page.getByRole("link", { name: "Explore", exact: true }).first().click();
    await expect(page).toHaveURL(/\/map/);
    await expect(page.locator(CARD)).toHaveCount(0);
    const search = page.locator(".mapToolbar").getByRole("combobox", { name: "Search pubs" });
    await search.fill("Boundary Reader Pub");
    const response = page.waitForResponse((reply) => new URL(reply.url()).pathname === "/data/venues_slim.json");
    release();
    await response;
    await expect(page.getByRole("listbox", { name: "Search suggestions" }).getByRole("option").filter({ hasText: "Boundary Reader Pub" }).first()).toBeVisible({ timeout: 25000 });
    expect(indexReads).toBe(1);
    expect(failedIndexReads).toEqual([]);
    await page.screenshot({ path: info.outputPath("shared-index-map-search.png") });
  } finally { release(); }
});
