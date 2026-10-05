import { join } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";
import { COMMUNITY_SHEET_FIXTURE_MAP_PATH } from "./helpers/communitySheetFixture";

const PHOTO_FIXTURE = join(process.cwd(), "e2e/fixtures/bill.jpg");

async function openComposer(page: Page): Promise<Locator> {
  await page.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();

  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  const pintsPanel = venueSheet.locator("#venuePanel-pints");
  await expect(pintsPanel).toBeVisible();

  const form = page.locator("form.dropComposer");
  const open = pintsPanel.getByRole("button", { name: /log a pint drop/i });
  await expect(async () => {
    await open.click();
    await expect(form).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });

  return form;
}

async function expectImageDecoded(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      }),
    )
    .toBe(true);
}

async function setExtrasOpen(extras: Locator, expanded: boolean): Promise<void> {
  await expect(async () => {
    if ((await extras.getAttribute("aria-expanded")) !== String(expanded)) {
      await extras.click();
    }
    await expect(extras).toHaveAttribute("aria-expanded", String(expanded), {
      timeout: 1_000,
    });
  }).toPass({ timeout: 20_000 });
}

test("mobile Spill keeps decoded pint and bill photos across Extras remount", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const auth = await installAuthDoubles(page);
  await page.goto("/");
  await auth.signedInAs("A");

  const form = await openComposer(page);
  await form.getByLabel("What did it cost?").fill("4.50");
  const receiptStep = form.getByTestId("spill-receipt-step");
  await expect(receiptStep).toBeVisible();

  const extras = form.getByRole("button", {
    name: "Add a photo or story",
    exact: true,
  });
  await expect(extras).toHaveAttribute("aria-expanded", "false");
  await setExtrasOpen(extras, true);

  // Reuse the decode-valid JPEG fixture; no form submission sends either file.
  await form
    .getByLabel("Snap the pour: snap or upload a pint photo")
    .setInputFiles(PHOTO_FIXTURE);
  const pintImage = form.getByRole("img", { name: "Preview of your pint photo" });
  await expectImageDecoded(pintImage);

  await form
    .getByLabel("The bill: snap or upload a photo of the bill")
    .setInputFiles(PHOTO_FIXTURE);
  const billImage = form.getByRole("img", {
    name: "Preview of the bill behind your price",
  });
  await expectImageDecoded(billImage);

  await setExtrasOpen(extras, false);
  await expect(pintImage).toHaveCount(0);
  await expect(receiptStep).toBeVisible();
  await expectImageDecoded(billImage);

  await setExtrasOpen(extras, true);
  const remountedPintImage = form.getByRole("img", {
    name: "Preview of your pint photo",
  });
  await expectImageDecoded(remountedPintImage);
  await expectImageDecoded(billImage);

  await remountedPintImage.scrollIntoViewIfNeeded();
  await testInfo.attach("pint-preview-after-extras-remount.png", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  // This case ends before submission. It exercises local photo previews only.
});
