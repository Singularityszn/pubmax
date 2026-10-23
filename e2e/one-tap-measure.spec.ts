import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { attachBill, readPriceSubmission } from "./helpers/priceBill";

/**
 * THE ONE-TAP PRICE DOOR ASKS THE MEASURE (review finding F-2, battle test D04).
 *
 * #1517 made "What's it tonight?" the single primary price door on a pub's
 * Overview. It offered a Beer chip, a price field and nothing else, and the
 * paired `pint_drops` row was stamped `measure: "pint"` on a value nobody was
 * asked. A drinker holding a half tapped Beer, typed 2.60, and the row a second
 * reporter could confirm into pin colour, the cheapest-pint buckets and the
 * Pint Index said pint.
 *
 * This drives the real door at 390: the chips render above the price field, a
 * half really travels in the request, and the pub's pin colour does not move
 * for it. The write itself is answered by a route double in the shape the route
 * answers, because the keyless e2e server verifies no bearer; the server rule
 * that a half writes no community price is pinned at the route
 * (__tests__/priceSubmitRoute.test.ts).
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

const UNPRICED = "venue-1kt3p9o";

type Submitted = { measure?: string; drinkCategory?: string; priceGbp?: number };

async function serveNoDrops(page: Page): Promise<void> {
  await page.route("**/api/pint-drops**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: [] }),
    });
  });
}

/** Records what the door sent, and answers as the route answers a half. */
async function captureSubmission(page: Page, sent: Submitted[]): Promise<void> {
  await page.route("**/api/price-submit", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = readPriceSubmission(route.request()) as Submitted;
    sent.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        attribution: { status: "credited", handle: "tester" },
        // A half writes no community price: the lane carries no measure column.
        price: null,
        measure: body.measure,
        measureName: body.measure === "half" ? "Half" : "Pint",
      }),
    });
  });
}

async function openVenueSheet(page: Page) {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible({ timeout: 30_000 });
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  // The sheet's body waits on the pub index, which a loaded box can hold past the
  // default 10 s: give it the same budget as the sheet itself.
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()), {
      timeout: 30_000,
    })
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible({ timeout: 30_000 });
  return venueSheet;
}

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

test("a half logged through the one-tap door travels as a half and moves no pin colour", async ({
  page,
}) => {
  const sent: Submitted[] = [];
  const stub = await installAuthDoubles(page);
  await serveNoDrops(page);
  await captureSubmission(page, sent);
  await page.goto("/");
  await stub.signedInAs("A");

  await page.goto(`/map?sel=${UNPRICED}`);
  const sheet = await openVenueSheet(page);

  const door = sheet.locator('[data-price-door="log"]');
  await expect(door).toBeVisible({ timeout: 30_000 });
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  // The door scrolls the price field into view and focuses it in one frame;
  // focus is the sign the composer has settled where it will be measured.
  await expect(submit.getByRole("textbox", { name: /Price of a beer at/ })).toBeFocused();

  // The closed question stands above the figure.
  const chips = submit.locator(".measureChip");
  await expect(chips).toHaveCount(3);
  const chipBox = await chips.first().boundingBox();
  const priceBox = await submit.locator(".vpsubField").boundingBox();
  expect(chipBox?.y ?? 0).toBeLessThan(priceBox?.y ?? 0);
  expect(chipBox?.height ?? 0, "a measure chip is a thumb target").toBeGreaterThanOrEqual(44);

  await submit.getByRole("radio", { name: "Half" }).click();
  await expect(submit.getByRole("radio", { name: "Half" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await submit.getByRole("textbox", { name: /Price of a beer at/ }).fill("2.60");
  await attachBill(submit);
  await submit.getByRole("button", { name: "Log it" }).click();

  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  expect(sent[0]).toMatchObject({ drinkCategory: "beer", measure: "half", priceGbp: 2.6 });

  // The receipt names the serving and claims the pub's page alone.
  await expect(sheet.locator(".vpsubStampBlock")).toContainText("Half");
  await expect(sheet.locator(".vpsubStampBlock")).toContainText("On this pub’s page");
  await expect(sheet.locator(".vpsubStampBlock")).not.toContainText("On the map");
});

test("a pint logged through the same door still says pint", async ({ page }) => {
  const sent: Submitted[] = [];
  const stub = await installAuthDoubles(page);
  await serveNoDrops(page);
  await captureSubmission(page, sent);
  await page.goto("/");
  await stub.signedInAs("A");

  await page.goto(`/map?sel=${UNPRICED}`);
  const sheet = await openVenueSheet(page);
  const door = sheet.locator('[data-price-door="log"]');
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await expect(submit.getByRole("textbox", { name: /Price of a beer at/ })).toBeFocused();

  // Pint is the default and it is a REAL answer on screen, not an assumption.
  await expect(submit.getByRole("radio", { name: "Pint" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await submit.getByRole("textbox", { name: /Price of a beer at/ }).fill("5.50");
  await attachBill(submit);
  await submit.getByRole("button", { name: "Log it" }).click();

  await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
  expect(sent[0]).toMatchObject({ measure: "pint", priceGbp: 5.5 });
});
