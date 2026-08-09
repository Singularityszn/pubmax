import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

// The photo picker and the crop step, on a phone-sized viewport.
//
// What this CAN prove: the picker input's own attributes, that a chosen photo
// opens a crop step rather than uploading, that the crop reaches the existing
// route as a JPEG cut to the slot's box, and that a file the browser cannot
// decode is refused with a sentence a person can act on.
//
// What no browser test can prove: that iOS now offers the photo library. The
// sheet `capture` suppressed belongs to the operating system, and Playwright
// never opens it. That half is fenced on the source in
// __tests__/profilePhotoPicker.test.ts.

const VIEWPORT = { width: 390, height: 844 };
const SHOT_DIR = "/tmp/pubmax-photo-crop";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000a";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "cropproof";
const PROFILE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/**
 * A landscape photo with an off-centre mark, so a crop has something to cut
 * into and a drag visibly changes what survives.
 */
function widePng(): Promise<Buffer> {
  return sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 196, g: 122, b: 46 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="900" height="600">' +
            '<rect x="0" y="0" width="240" height="600" fill="#16283a"/>' +
            '<circle cx="700" cy="180" r="110" fill="#f4efe6"/>' +
            "</svg>",
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function installOwnedProfileBoundary(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: "pubmaxx-e2e-access-token",
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "crop-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-08-01T00:00:00.000Z",
        },
      }),
    );
  }, { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID });

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "crop-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: HANDLE, dateOfBirth: "1994-03-02" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: HANDLE }),
    });
  });
}

type UploadRecord = { bodies: Buffer[] };

/**
 * Answer the slot's upload route in the browser and keep the bytes it received,
 * so the test measures the JPEG the crop actually produced.
 */
async function captureUpload(page: Page, slot: "avatar" | "cover"): Promise<UploadRecord> {
  const record: UploadRecord = { bodies: [] };
  await page.route(`**/api/profiles/${HANDLE}/${slot}`, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postDataBuffer();
    if (body) record.bodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: PROFILE_ID,
          handle: HANDLE,
          displayName: "Crop proof",
          [slot === "avatar" ? "avatarUrl" : "coverUrl"]:
            `/api/${slot}/${PROFILE_ID}/${GENERATION}`,
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
      }),
    });
  });
  const png = await widePng();
  await page.route(`**/api/${slot}/${PROFILE_ID}/${GENERATION}`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/png" },
      body: png,
    });
  });
  return record;
}

/** Pull the one JPEG out of a multipart body and measure it. */
async function measureUploaded(record: UploadRecord) {
  expect(record.bodies).toHaveLength(1);
  const body = record.bodies[0];
  const start = body.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const end = body.lastIndexOf(Buffer.from([0xff, 0xd9]));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const jpeg = body.subarray(start, end + 2);
  const metadata = await sharp(jpeg).metadata();
  return { format: metadata.format, width: metadata.width, height: metadata.height };
}

async function openOwnProfileEditor(page: Page): Promise<void> {
  const response = await page.goto(`/u/${HANDLE}`);
  expect(response?.status()).toBe(200);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
}

async function pick(page: Page, slot: "avatar" | "cover", name: string): Promise<void> {
  await page.locator(`#pe-${slot}-file`).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: await widePng(),
  });
}

test.describe("profile photo picker and crop", () => {
  test.use({ viewport: VIEWPORT });

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true });
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await installOwnedProfileBoundary(page);
  });

  test("both pickers ask for photos and neither asks for a camera", async ({ page }) => {
    await openOwnProfileEditor(page);

    for (const id of ["#pe-avatar-file", "#pe-cover-file"]) {
      const input = page.locator(id);
      await expect(input).toHaveAttribute("type", "file");
      // `capture` is what removed Photo Library from the iOS sheet.
      expect(await input.getAttribute("capture")).toBeNull();
      const accept = (await input.getAttribute("accept")) ?? "";
      expect(accept).toContain("image/heic");
      expect(accept).toContain("image/jpeg");
      expect(accept).not.toContain("*");
    }
  });

  test("a chosen photo opens the crop step before anything uploads", async ({ page }) => {
    const record = await captureUpload(page, "avatar");

    await openOwnProfileEditor(page);
    await pick(page, "avatar", "IMG_2201.png");

    await expect(page.getByRole("heading", { name: "Position your photo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use photo" })).toBeEnabled();
    expect(record.bodies).toHaveLength(0);

    await page.locator(".profileCropStep").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOT_DIR, "crop-avatar-390.png"), fullPage: true });

    // Cancel puts the slot back the way it was, with nothing sent.
    await page.locator(".profileCropCancel").click();
    await expect(page.locator(".profileCropStep")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose photo" })).toBeVisible();
    expect(record.bodies).toHaveLength(0);
  });

  test("the avatar crop uploads a square JPEG at the slot's own size", async ({ page }) => {
    const record = await captureUpload(page, "avatar");
    await openOwnProfileEditor(page);
    await pick(page, "avatar", "IMG_2202.png");

    const zoom = page.locator("#pe-avatar-zoom");
    await expect(zoom).toBeEnabled();
    await zoom.fill("40");
    await page.locator(".profileCropStep").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(SHOT_DIR, "crop-avatar-zoomed-390.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Use photo" }).click();
    await expect(page.locator(".profileCropStep")).toHaveCount(0);

    expect(await measureUploaded(record)).toEqual({
      format: "jpeg",
      width: 512,
      height: 512,
    });
  });

  test("the cover crop uploads a wide JPEG at the slot's own size", async ({ page }) => {
    const record = await captureUpload(page, "cover");
    await openOwnProfileEditor(page);
    await pick(page, "cover", "IMG_2203.png");

    await expect(
      page.getByRole("heading", { name: "Position your cover photo" }),
    ).toBeVisible();
    await page.locator(".profileCropStep").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(SHOT_DIR, "crop-cover-390.png"), fullPage: true });

    // Drag the photo across the wide frame, then take what is under it.
    const frame = page.locator(".profileCropStep-cover .profileCropFrame");
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await page.getByRole("button", { name: "Use cover photo" }).click();
    await expect(page.locator(".profileCropStep")).toHaveCount(0);

    expect(await measureUploaded(record)).toEqual({
      format: "jpeg",
      width: 1600,
      height: 533,
    });
  });

  test("a photo this browser cannot open says where to go instead", async ({ page }) => {
    const record = await captureUpload(page, "avatar");
    await openOwnProfileEditor(page);

    // Chromium decodes no HEIC, which is exactly the case the copy is for. On a
    // browser that DOES decode it (Safari), the crop re-encodes it to JPEG and
    // the upload succeeds, which the two crop tests above already cover.
    await page.locator("#pe-avatar-file").setInputFiles({
      name: "IMG_2204.HEIC",
      mimeType: "image/heic",
      buffer: Buffer.from("AAAAGGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZg==", "base64"),
    });

    const status = page.locator(".profileCropStep [role='status']");
    await expect(status).toBeVisible();
    await expect(status).toContainText(/Open it in Photos, share it as a JPEG/i);
    await expect(page.getByRole("button", { name: "Use photo" })).toBeDisabled();
    expect(record.bodies).toHaveLength(0);

    await page.locator(".profileCropStep").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(SHOT_DIR, "crop-heic-refused-390.png"),
      fullPage: true,
    });
  });
});
