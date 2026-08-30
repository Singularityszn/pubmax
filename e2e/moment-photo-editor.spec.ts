import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROOF_PATH = "docs/proof/moment-photo-editor/moment-editor-390.png";
const PHOTO = readFileSync(resolve(process.cwd(), "docs/proof/night-mode-mid-crawl/after-390.png"));

test.describe("Moment photo editor", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });
  });

  test("loads editor only after Edit and keeps original on cancel", async ({ page }) => {
    // Two buckets, not one. A single list would let a request that arrived
    // BEFORE the click satisfy the "the editor was fetched" assertion below,
    // and that assertion is the whole proof that the third-party CDN is not
    // contacted until somebody asks for the editor. The flag flips immediately
    // before click(), so only what the click caused lands in the second bucket.
    const cdnBeforeEdit: string[] = [];
    const cdnAfterEdit: string[] = [];
    let editRequested = false;
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "cdn.unlayer.com") return;
      (editRequested ? cdnAfterEdit : cdnBeforeEdit).push(request.url());
    });

    const momentUrl = process.env.PW_MOMENT_BASE_URL
      ? `${process.env.PW_MOMENT_BASE_URL}/moment`
      : "/moment";
    await page.goto(momentUrl);
    await page.locator('input[type="file"]').setInputFiles({
      name: "night.png",
      mimeType: "image/png",
      buffer: PHOTO,
    });
    await expect(page.getByRole("button", { name: "Edit night.png" })).toBeVisible();
    expect(cdnBeforeEdit).toEqual([]);

    editRequested = true;
    await page.getByRole("button", { name: "Edit night.png" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit photo" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close editor" })).toBeVisible();
    // Re-assert after the action settles: Playwright runs actionability checks
    // between the flag flip and the real dispatch, so this is what proves
    // nothing was fetched while the click was still being prepared.
    expect(cdnBeforeEdit).toEqual([]);
    await expect.poll(() => cdnAfterEdit.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: PROOF_PATH, fullPage: false });

    await page.getByRole("button", { name: "Close editor" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("img", { name: "Moment preview" })).toBeVisible();
  });
});
