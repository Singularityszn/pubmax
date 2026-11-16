import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const MIN_TAP_TARGET = 44;

test("merged ledger link reaches one canonical destination under service-worker control", async ({ page }) => {
  await page.goto("/pubs/venue-7qifhm");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
  });

  const redirect = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/ledger/venue-aihlwx",
  );
  const response = await page.goto("/ledger/venue-aihlwx");
  const legacyResponse = await redirect;

  expect(legacyResponse.fromServiceWorker()).toBe(true);
  expect(legacyResponse.status()).toBe(308);
  expect(await legacyResponse.headerValue("location")).toBe("/ledger/venue-7qifhm");
  await expect(page).toHaveURL(/\/ledger\/venue-7qifhm$/);
  expect(response?.status()).toBe(200);
});

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey exactly so the
// spec can deep-link straight to a stable, real seed venue without depending on
// a MapLibre canvas pin click in headless Chromium.
function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));

  expect(Math.max(overflow.bodyScrollWidth, overflow.documentScrollWidth)).toBeLessThanOrEqual(
    overflow.viewportWidth,
  );
}

async function expectTappable(locator: Locator, label: string) {
  await expect(locator, label).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a bounding box`).not.toBeNull();
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          window.sessionStorage.setItem("pubmax-e2e-mobile-share-copy", value);
        },
      },
    });
  });
});

test("mobile Ledger for a known venue is usable with tappable actions and no horizontal overflow", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/ledger/${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Arnos Arms" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Logbook" })).toBeVisible();
  await expect(
    page.locator(".ledgerEntries, .ledgerEmptyEntries").first(),
    "logbook entries or empty state",
  ).toBeVisible();

  await page.locator(".ledgerSecondaryActions summary").click();
  const headActions = page.locator(".ledgerHeadActions");
  await expectTappable(headActions.getByRole("link", { name: "Open on the map" }), "map link");
  await expectTappable(headActions.getByRole("link", { name: "See the bar tab" }), "bar-tab link");
  await expectTappable(
    headActions.getByRole("button", { name: "Share this ledger" }),
    "share ledger button",
  );
  const community = page.locator(".ledgerCommunity");
  const familyShare = community.getByRole("button", { name: "Share with family" });
  await expect(async () => {
    const summary = community.locator("summary");
    if (await summary.isVisible() && !(await community.evaluate((node) => (node as HTMLDetailsElement).open))) {
      await summary.click();
    }
    await expect(familyShare).toBeVisible();
  }).toPass();
  await expectTappable(familyShare, "family-table share button");

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});

test("mobile Bar Tab for a known venue has tappable Ledger and share controls", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/bar-tab/${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  await expect(page.getByText("The Bar Tab", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Arnos Arms" })).toBeVisible();

  const headActions = page.locator(".barTabHeadActions");
  await expectTappable(headActions.getByRole("link", { name: "Open on the map" }), "map link");
  await expectTappable(headActions.getByRole("link", { name: "Read the ledger" }), "ledger link");

  const shareControls = headActions.locator(".shareBar__btn");
  await expect(shareControls.first()).toBeVisible();
  const shareCount = await shareControls.count();
  expect(shareCount, "share controls").toBeGreaterThanOrEqual(3);
  for (let index = 0; index < shareCount; index += 1) {
    await expectTappable(shareControls.nth(index), `share control ${index + 1}`);
  }

  await expectNoHorizontalOverflow(page);
  expect(errors).toEqual([]);
});
