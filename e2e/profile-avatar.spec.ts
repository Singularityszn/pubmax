import { expect, test, type Page } from "@playwright/test";

// Social Launch WP5: owned-avatar dress rehearsal on the production-style
// Playwright server (next build + next start, PUBMAX_E2E_KEYLESS=1).
//
// The keyless server has no Supabase storage bucket and no OPENAI_API_KEY, so
// a real upload stops at the first honest refusal (storage or moderation). The
// moderation-outage copy ("We could not check this photo. Try again.") is pinned
// in __tests__/profileAvatarRoute.test.ts with injected memory storage.
//
// The upload → render → report → hide loop rehearses the captain demo UI with
// browser route doubles for write paths that need durable storage, while
// separate request tests prove the real moderation API refuses honestly when the
// queue is empty or the caller lacks a moderator token.

const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000a";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const E2E_ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";
const LOOP_HANDLE = "avatarproof";
const LOOP_GENERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOOP_PROFILE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Minimal valid JPEG (1×1) for multipart upload attempts. */
function tinyJpeg(): Buffer {
  return Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
    "base64",
  );
}

async function seedSignedInSession(page: Page): Promise<void> {
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
          email: "avatar-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId: E2E_AUTH_USER_ID,
  });
}

async function installOwnedProfileBoundary(page: Page): Promise<void> {
  await seedSignedInSession(page);
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "avatar-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        complete: true,
        handle: LOOP_HANDLE,
        dateOfBirth: "1995-06-15",
      }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: LOOP_HANDLE }),
    });
  });
}

/**
 * Choosing a photo now opens the crop step; the upload starts when a person
 * confirms it. e2e/profile-photo-crop.spec.ts owns that step's own contract.
 */
async function confirmCrop(page: Page): Promise<void> {
  const confirm = page.getByRole("button", { name: "Use photo" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function openOwnProfileEditor(page: Page): Promise<void> {
  const response = await page.goto(`/u/${LOOP_HANDLE}`);
  expect(response?.status()).toBe(200);
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("anonymous upload is refused before storage or moderation run", async ({ request }) => {
  const response = await request.post("/api/profiles/nobody/avatar", {
    multipart: {
      photo: {
        name: "face.jpg",
        mimeType: "image/jpeg",
        buffer: tinyJpeg(),
      },
    },
  });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body.error).toMatch(/sign in with the account that owns this handle/i);
});

test("report and admin moderation refuse honestly without an approved avatar or token", async ({
  request,
}) => {
  const report = await request.post("/api/profiles/missing-avatar/avatar/report", {
    data: { reason: "test" },
  });
  expect(report.status()).toBe(404);
  expect((await report.json()).error).toMatch(/not found/i);

  const adminList = await request.get("/api/admin/profile-avatars?status=reported");
  expect(adminList.status()).toBe(403);
  expect((await adminList.json()).error).toMatch(/not authorised/i);
});

test("owner upload surfaces honest refusal when the keyless server cannot verify auth", async ({
  page,
}) => {
  await installOwnedProfileBoundary(page);
  await openOwnProfileEditor(page);

  await page.locator("#pe-avatar-file").setInputFiles({
    name: "face.jpg",
    mimeType: "image/jpeg",
    buffer: tinyJpeg(),
  });
  await confirmCrop(page);

  const status = page.locator(".profileEditorStatusErr");
  await expect(status).toBeVisible();
  // Keyless production e2e has no Supabase admin JWT verification, so the write
  // stops at ownership before storage or OpenAI run. Storage/moderation outage
  // copy is pinned in __tests__/profileAvatarRoute.test.ts with injected storage.
  await expect(status).toContainText(
    /sign in with the account that owns this handle|could not check this photo|photo storage is unavailable|profile storage is unavailable/i,
  );
});

test("upload → render → report → hide dress rehearsal", async ({ page }) => {
  test.setTimeout(60_000);
  await installOwnedProfileBoundary(page);

  const avatarUrl = `/api/avatar/${LOOP_PROFILE_ID}/${LOOP_GENERATION}`;
  const publicProfile = {
    id: LOOP_PROFILE_ID,
    handle: LOOP_HANDLE,
    displayName: "Avatar proof",
    avatarUrl,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };

  let uploadCalls = 0;
  let reportCalls = 0;
  let hideCalls = 0;
  let hidden = false;

  await page.route(`**/api/profiles/${LOOP_HANDLE}/avatar`, async (route) => {
    if (route.request().method() === "POST") {
      uploadCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: publicProfile }),
      });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/profiles/${LOOP_HANDLE}`, async (route) => {
    if (route.request().method() === "GET") {
      const profile = hidden ? { ...publicProfile, avatarUrl: undefined } : publicProfile;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile }),
      });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/avatar/${LOOP_PROFILE_ID}/${LOOP_GENERATION}`, async (route) => {
    if (hidden) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Photo not found." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=300" },
      body: tinyJpeg(),
    });
  });
  await page.route(`**/api/profiles/${LOOP_HANDLE}/avatar/report`, async (route) => {
    reportCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/admin/profile-avatars**", async (route) => {
    if (route.request().method() === "POST") {
      hideCalls += 1;
      hidden = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ avatars: hidden ? [{ handle: LOOP_HANDLE }] : [] }),
    });
  });

  await openOwnProfileEditor(page);
  await page.locator("#pe-avatar-file").setInputFiles({
    name: "face.jpg",
    mimeType: "image/jpeg",
    buffer: tinyJpeg(),
  });
  await confirmCrop(page);
  await expect(page.locator(".profileEditorAvatarPreview")).toBeVisible();
  expect(uploadCalls).toBeGreaterThan(0);

  await page.goto(`/u/${LOOP_HANDLE}`);
  await expect(page.locator(".profileAvatar")).toBeVisible();

  await page.evaluate(async (handle) => {
    await fetch(`/api/profiles/${handle}/avatar/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "dress rehearsal" }),
    });
  }, LOOP_HANDLE);
  expect(reportCalls).toBe(1);

  await page.evaluate(
    async ({ handle, token }) => {
      await fetch("/api/admin/profile-avatars", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ action: "hide", handle, note: "wp5 rehearsal" }),
      });
    },
    { handle: LOOP_HANDLE, token: E2E_ADMIN_TOKEN },
  );
  expect(hideCalls).toBe(1);

  await page.reload();
  await expect(page.locator(".profileAvatarFallback")).toBeVisible();
});
