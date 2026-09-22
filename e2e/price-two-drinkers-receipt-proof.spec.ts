import { expect, test, type Locator, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { attachBill, attachSpillBill } from "./helpers/priceBill";

/**
 * PROOF SHOTS for the 7 September 2026 cut: two drinkers with two prices are
 * two prices, and a new price comes with a photo of the bill.
 *
 * Two surfaces, at 390 and 1440, over The Sir Christopher Hatton with
 * `/api/pint-drops` answered by a route mock in the shape production answers
 * it. The split fixture is the pub Grok read on the 08:37 deploy: £4.50 and
 * £4.70, both public, both in window.
 *
 * Shots land in docs/proof/price-two-drinkers-receipt/.
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

const PROOF = "docs/proof/price-two-drinkers-receipt";
const HATTON = "venue-1vle947";
const DAY_MS = 24 * 60 * 60 * 1000;

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;

type DropRow = Record<string, unknown>;

function row(overrides: DropRow = {}): DropRow {
  return {
    id: "e3f592df-0dc3-434e-a6a4-a154e5358bbc",
    venueId: HATTON,
    handle: "tester",
    drink: "Lager",
    measure: "pint",
    priceGbp: 4.7,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    pintPhotoUrl: null,
    venuePhotoUrl: null,
    receiptPhotoUrl: null,
    venueName: "The Sir Christopher Hatton",
    venueMapUrl: `/map?sel=${HATTON}`,
    ...overrides,
  };
}

/** The Hatton lane on the 08:37 deploy: one drink, two figures, two drinkers. */
const SPLIT: DropRow[] = [
  row(),
  row({
    id: "drop-2",
    handle: "second_drinker",
    authorityKey: "account-second",
    priceGbp: 4.5,
    createdAt: new Date(Date.now() - 5 * DAY_MS).toISOString(),
  }),
];

async function serveDrops(page: Page, drops: DropRow[]): Promise<void> {
  await page.route("**/api/pint-drops**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops }),
    });
  });
}

async function quietPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
}

/** A React re-render can detach the element between the wait and the shot. */
async function shoot(locator: Locator, path: string): Promise<void> {
  await expect(async () => {
    await locator.first().screenshot({ path });
  }).toPass({ timeout: 20_000 });
}

async function openVenueSheet(page: Page): Promise<Locator> {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  const desktopInspector = page.locator(".venueInspector").first();
  await expect
    .poll(async () => (await venueSheet.isVisible()) || (await desktopInspector.isVisible()), {
      timeout: 30_000,
    })
    .toBe(true);
  if (!(await venueSheet.isVisible())) return desktopInspector;
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()))
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return inspector;
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey, the same hash
// e2e/spill-composer.spec.ts uses to deep-link a seed pub without a canvas tap.
function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

const ARNOS_ARMS = stableVenueIdFromKey(
  ["arnos arms", "338 bowes road, arnos grove, london, n11 1an", "51.61620", "-0.13212"].join("|"),
);

/** Open the full Pint Drop composer on the Stories tab of an open pub sheet. */
async function openSpillComposer(page: Page, inspector: Locator): Promise<Locator> {
  await inspector.getByRole("tab", { name: "Stories", exact: true }).click();
  const pintsPanel = inspector.locator("#venuePanel-pints");
  await expect(pintsPanel).toBeVisible();
  await expect(async () => {
    await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();
    await expect(page.locator("form.dropComposer")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return page.locator("form.dropComposer");
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}px: the Overview says both prices and asks which one`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);
    const stub = await installAuthDoubles(page);
    await serveDrops(page, SPLIT);
    await page.goto("/");
    await stub.signedInAs("A");

    await page.goto(`/map?sel=${HATTON}`);
    const inspector = await openVenueSheet(page);
    const priceArea = inspector.locator('[data-pint-trust="disputed"]');
    await expect(priceArea).toBeVisible({ timeout: 30_000 });
    // The words the captain asked for, and the line that may never stand here.
    await expect(priceArea).toContainText("Two drinkers, two prices: £4.50 and £4.70");
    await expect(priceArea).not.toContainText("Logged once");
    await expect(priceArea).toContainText("Which did you pay?");
    await priceArea.scrollIntoViewIfNeeded();
    await shoot(priceArea, `${PROOF}/split-overview-${viewport.name}.png`);
    await priceArea.getByTestId("choose-pint-cta").filter({ hasText: "£4.50" }).click();
    const composer = page.getByTestId("spill-price-step");
    await expect(composer).toBeVisible();
    await expect(composer.getByLabel("What did it cost?")).toHaveValue("4.50");
    await expect(composer.getByLabel("Drink", { exact: true })).toHaveValue("Lager");
    await expect(composer.getByRole("radio", { name: "Pint", exact: true })).toHaveAttribute("aria-checked", "true");
  });

  test(`${viewport.name}px: the composer asks for the bill, then the pint`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);
    const stub = await installAuthDoubles(page);
    await serveDrops(page, []);
    await page.goto("/");
    await stub.signedInAs("A");

    await page.goto(`/map?sel=${HATTON}`);
    const inspector = await openVenueSheet(page);
    const door = inspector.locator('[data-price-door="log"]');
    await expect(door).toHaveCount(1, { timeout: 30_000 });
    await door.click();
    const submit = inspector.locator(".venuePriceSubmit");
    await expect(submit).toBeVisible();
    await submit.getByRole("textbox", { name: /Price of a beer at/ }).fill("4.50");

    // Before: the bill is asked for and Log it will not go.
    await expect(submit.getByRole("button", { name: "Log it" })).toBeDisabled();
    await submit.scrollIntoViewIfNeeded();
    await shoot(submit, `${PROOF}/composer-no-bill-${viewport.name}.png`);

    // After: the bill is in, Log it is live, and the pint photo is offered.
    await attachBill(submit);
    await expect(submit.getByRole("button", { name: "Log it" })).toBeEnabled();
    await expect(submit.getByTestId("pint-photo-btn")).toBeVisible();
    await shoot(submit, `${PROOF}/composer-with-bill-${viewport.name}.png`);
  });

  test(`${viewport.name}px: the full composer asks for the bill under the price`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await quietPage(page);
    const stub = await installAuthDoubles(page);
    await serveDrops(page, []);
    await page.goto("/");
    await stub.signedInAs("A");

    await page.goto(`/map?sel=${ARNOS_ARMS}`);
    const inspector = await openVenueSheet(page);
    const form = await openSpillComposer(page, inspector);

    // No price, no bill: a note or a photo of the pub claims nothing.
    await expect(form.getByTestId("spill-receipt-step")).toHaveCount(0);

    await form.getByLabel("What did it cost?").fill("4.50");
    const bill = form.getByTestId("spill-receipt-step");
    // In front of the drinker, not behind "Add a photo or story".
    await expect(bill).toBeVisible();
    await expect(bill).toContainText("Add a photo of the bill");
    await bill.scrollIntoViewIfNeeded();
    await shoot(bill, `${PROOF}/spill-bill-asked-${viewport.name}.png`);

    await attachSpillBill(form);
    await expect(bill).toContainText("Bill ready");
    await shoot(bill, `${PROOF}/spill-bill-ready-${viewport.name}.png`);
  });
}
