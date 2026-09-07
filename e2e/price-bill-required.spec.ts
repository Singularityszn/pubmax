import { expect, test, type Page } from "@playwright/test";

import { RECEIPT_REQUIRED_LINE } from "@/lib/pintDropReceipt";

import { installAuthDoubles } from "./helpers/authDoubles";
import { attachBill } from "./helpers/priceBill";

/**
 * A NEW PRICE COMES WITH THE BILL, on a 390 phone (captain 7 Sept 2026:
 * "whenever a person is submitting a new price, they have to take a picture of
 * the bill").
 *
 * The whole loop as a drinker meets it: the price door opens the composer, a
 * figure alone will not go and the composer says why in one line, the bill
 * makes Log it live, and the price lands. The pint photo is offered only after
 * the bill and never blocks anything.
 *
 * The write is answered by a boundary double in the route's own shape, because
 * the keyless e2e server stores no photos: what this proves is the COMPOSER's
 * half of the rule and the body it sends. The server's half is pinned at the
 * route (`__tests__/pintDrops.test.ts`, `__tests__/priceSubmitRoute.test.ts`).
 */
test.use({
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  viewport: { width: 390, height: 844 },
});

const HATTON = "venue-1vle947";

test.setTimeout(120_000);

type SubmittedBody = { hasReceipt: boolean; priceGbp: string | null };

/** The write door, answered in the shape the route answers, recording the body. */
async function interceptSubmit(page: Page, submitted: SubmittedBody[]): Promise<void> {
  await page.route("**/api/price-submit", async (route) => {
    const raw = route.request().postData() ?? "";
    submitted.push({
      hasReceipt: raw.includes('name="receipt_photo"'),
      priceGbp: /name="priceGbp"\r?\n\r?\n([^\r\n]*)/.exec(raw)?.[1] ?? null,
    });
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        price: {
          venueId: HATTON,
          drinkCategory: "beer",
          priceGbp: 4.5,
          submittedAt: Date.now(),
          source: "community",
          corroborations: 1,
        },
        attribution: { status: "attributed", handle: "night_owl" },
        pintTrust: "logged-once",
        confirmationOutcome: { status: "awaiting_second_drinker" },
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

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
  await page.route("**/api/pint-drops**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ drops: [] }),
    });
  });
});

test("a price with no bill is refused in one line, and the bill sends it", async ({ page }) => {
  const submitted: SubmittedBody[] = [];
  const stub = await installAuthDoubles(page);
  await interceptSubmit(page, submitted);
  await page.goto("/");
  await stub.signedInAs("A");

  await page.goto(`/map?sel=${HATTON}`);
  const sheet = await openVenueSheet(page);

  // The one door, taken: the composer unfolds in its place.
  const door = sheet.locator('[data-price-door="log"]');
  await expect(door).toHaveCount(1, { timeout: 30_000 });
  await door.click();
  const submit = sheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();

  // A FIGURE ALONE WILL NOT GO, and the composer says why before the tap.
  await submit.getByRole("textbox", { name: /Price of a beer at/ }).fill("4.50");
  await expect(submit).toContainText(RECEIPT_REQUIRED_LINE);
  const logButton = submit.getByRole("button", { name: "Log it" });
  await expect(logButton).toBeDisabled();
  // The optional pint photo is not offered yet: the bill comes first.
  await expect(submit.getByTestId("pint-photo-btn")).toHaveCount(0);
  expect(submitted, "nothing reached the write door").toHaveLength(0);

  // THE BILL. Log it comes alive, the line goes, and the playful second ask
  // arrives in its place.
  await attachBill(submit);
  await expect(logButton).toBeEnabled();
  await expect(submit).not.toContainText(RECEIPT_REQUIRED_LINE);
  await expect(submit.getByTestId("pint-photo-btn")).toBeVisible();

  await logButton.click();
  await expect(submit.locator(".vpsubStamp")).toBeVisible();
  expect(submitted).toHaveLength(1);
  expect(submitted[0].hasReceipt, "the bill rode with the price").toBe(true);
  expect(submitted[0].priceGbp).toBe("4.5");
});
