import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const EDITOR_SCRIPT = "https://cdn.unlayer.com/image-editor/embed.js";
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
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));

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
    expect(requests).not.toContain(EDITOR_SCRIPT);

    await page.getByRole("button", { name: "Edit night.png" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit photo" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "Close editor" })).toBeVisible();
    await expect.poll(() => requests.includes(EDITOR_SCRIPT), { timeout: 30_000 }).toBe(true);
    await page.screenshot({ path: PROOF_PATH, fullPage: false });

    await page.getByRole("button", { name: "Close editor" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("img", { name: "Moment preview" })).toBeVisible();
  });
});
