import sharp from "sharp";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { MapCameraReading } from "../components/map/canvas/cameraProbe";
import type { PaintedMapTapPoint } from "../components/map/canvas/paintedPinProbe";
import { UNPRICED_PIN_FILL } from "../lib/mapIcons";

import { ACCOUNTS, accountForBearer, installAuthDoubles } from "./helpers/authDoubles";
import { attachBill, installPriceUploadCapture } from "./helpers/priceBill";

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
  const readUpload = await installPriceUploadCapture(page, "/api/price-submit");
  await page.route("**/api/price-submit", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    expect(accountForBearer(route.request().headers().authorization)).toEqual(ACCOUNTS.A);
    const fields = await readUpload(route.request());
    const body: Submitted = { ...fields, priceGbp: Number(fields.priceGbp) };
    sent.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        attribution: { status: "credited", handle: ACCOUNTS.A.handle },
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
  await expect
    .poll(async () => (await inspector.isVisible()) || (await expand.isVisible()))
    .toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return venueSheet;
}

async function captureUnpricedPin(page: Page, testInfo: TestInfo, name: string) {
  await expect.poll(() => page.evaluate((id) => {
    const map = window as typeof window & {
      __pubmaxMapCamera?: { read: () => MapCameraReading };
      __pubmaxPaintedMapTapPoints?: () => PaintedMapTapPoint[];
    };
    return map.__pubmaxMapCamera?.read().moving === false &&
      map.__pubmaxPaintedMapTapPoints?.().some((point) => point.kind === "pin" && point.id === id);
  }, UNPRICED)).toBe(true);
  const state = await page.evaluate((id) => {
    const map = window as typeof window & {
      __pubmaxMapCamera: { read: () => MapCameraReading };
      __pubmaxPaintedMapTapPoints: () => PaintedMapTapPoint[];
    };
    return {
      point: map.__pubmaxPaintedMapTapPoints().find((point) => point.kind === "pin" && point.id === id)!,
      camera: map.__pubmaxMapCamera.read(),
      dpr: devicePixelRatio,
      theme: document.documentElement.getAttribute("data-theme"),
      lens: document.querySelector('button[aria-label^="Drink shown on the map:"]')?.getAttribute("aria-label"),
      selected: new URL(location.href).searchParams.get("sel"),
    };
  }, UNPRICED);
  expect(state.point).toBeDefined();
  expect(state.camera.moving).toBe(false);
  const clip = { x: Math.floor(state.point.x) - 12, y: Math.floor(state.point.y) - 12, width: 24, height: 24 };
  const screenshot = await page.screenshot({ clip, scale: "device" });
  await testInfo.attach(`${name}.png`, { body: screenshot, contentType: "image/png" });
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgb = UNPRICED_PIN_FILL.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16));
  const fillPixels: number[] = [];
  // Read opaque fill pixels across the glyph, not its hollow centre, rim or shadow.
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset] === rgb[0] && data[offset + 1] === rgb[1] &&
      data[offset + 2] === rgb[2] && data[offset + 3] === 255) fillPixels.push(offset / 4);
  }
  const witness = { ...state, clip, width: info.width, height: info.height, fillPixels };
  await testInfo.attach(`${name}.json`, {
    body: Buffer.from(JSON.stringify(witness, null, 2)), contentType: "application/json",
  });
  expect(fillPixels.length, "the actual pin must contain unpriced fill pixels").toBeGreaterThan(0);
  return witness;
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
}, testInfo) => {
  const sent: Submitted[] = [];
  const stub = await installAuthDoubles(page);
  await serveNoDrops(page);
  await captureSubmission(page, sent);
  await page.goto("/");
  await stub.signedInAs("A");

  await page.goto(`/map?sel=${UNPRICED}`);
  const sheet = await openVenueSheet(page);
  await sheet.getByRole("button", { name: "Close pub detail" }).click();
  await expect(sheet).toBeHidden();
  const before = await captureUnpricedPin(page, testInfo, "half-pin-before");
  await page.mouse.click(before.point.x, before.point.y);
  await openVenueSheet(page);


  const door = sheet.locator('[data-price-door="log"]');
  await expect(door).toBeVisible({ timeout: 30_000 });
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(async () => {
    await door.click();
    await expect(submit).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });

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

  await sheet.getByRole("button", { name: "Close pub detail" }).click();
  await expect(sheet).toBeHidden();
  const after = await captureUnpricedPin(page, testInfo, "half-pin-after");
  // Same venue, camera, theme, lens, selection, DPR, crop and opaque fill pixels.
  expect(after).toEqual(before);
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
