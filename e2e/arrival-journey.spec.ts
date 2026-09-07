import { expect, test, type Page } from "@playwright/test";

// Arrival is the moment of togetherness, never an admin form.
//
// DEFECT ZERO: an account that already owns a handle but never stored a date of
// birth (claimed through POST /api/identity/handle/claim, which takes no date of
// birth) reads back from GET /api/identity/onboarding as
// `{ complete: false, handle: "karan" }`. AccountOnboarding used to answer that
// with a blocking owned-identity dialog carrying a rename field, mounted at the
// app root inside AuthProvider, so it covered every tab and only a React-local
// flag ever dismissed it.
//
// The keyless Playwright server has no Supabase, so the session and the
// owner-only reads are browser route doubles, and a completed sign-in is
// reproduced by the state one leaves behind (the tab's arrival marker plus the
// remembered door). Every surface under test is the real shipped UI.

const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-0000000000a1";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "karan";

type OnboardingBody = { complete: boolean; handle?: string; dateOfBirth?: string };

type SessionOptions = {
  /** Reproduce the state a completed sign-in leaves in the landing tab. */
  arrival?: "signin" | "signup";
  deviceHandle?: string;
  foundingMemberNumber?: number;
};

async function installSession(
  page: Page,
  onboarding: OnboardingBody,
  options: SessionOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId, deviceHandle, arrival }) => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      if (deviceHandle) {
        window.localStorage.setItem("pubmax_handle", deviceHandle);
        // A completed sign-in stamps whose device this is; without it the
        // account boundary treats the cached handle as the previous person's
        // and clears it (lib/deviceAccountIdentity.ts).
        window.localStorage.setItem("pubmax_account_owner", userId);
      }
      if (arrival && !window.sessionStorage.getItem("pubmax:e2e:arrival-seeded")) {
        window.sessionStorage.setItem("pubmax:e2e:arrival-seeded", "true");
        window.sessionStorage.setItem(
          "pubmax:arrival-welcome:v1",
          JSON.stringify({ intent: arrival, at: Date.now() }),
        );
      }
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
            email: "founder@example.test",
            app_metadata: {},
            user_metadata: { full_name: "Karan" },
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    {
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
      deviceHandle: options.deviceHandle ?? "",
      arrival: options.arrival ?? "",
    },
  );

  // This journey does not assert the resume cookie. Keep fake sessions out of
  // the real route's shared persistence budget.
  await page.route("**/api/auth/session", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.postDataJSON()?.action === "persist"
    ) {
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fallback();
  });

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "founder@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(onboarding),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: onboarding.handle ?? null,
        foundingMemberNumber: options.foundingMemberNumber,
      }),
    });
  });
}

function identityDialog(page: Page) {
  return page.locator(".accountOnboardingBackdrop");
}

async function capture(page: Page, name: string): Promise<void> {
  const options = { path: test.info().outputPath(name), animations: "disabled" as const };
  try {
    await page.screenshot(options);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Protocol error (Page.captureScreenshot): Unable to capture screenshot")
    ) {
      throw error;
    }
    // Chromium can refuse the first composited frame while a sheet enters.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await page.screenshot(options);
  }
}

async function expectAccountReady(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: "You", exact: true })).toHaveAttribute(
    "href",
    `/u/${HANDLE}`,
  );
}

test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test.describe("returning drinker", () => {
  test("arrives with no identity sheet, on any tab", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-07T20:00:00Z"));
    // The founder's exact account: a claimed handle, no stored date of birth.
    await installSession(page, { complete: false, handle: HANDLE });

    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await expectAccountReady(page);
    await capture(page, "returning-1-today.png");

    await expect(identityDialog(page)).toHaveCount(0);
    await expect(page.getByText("Rename handle")).toHaveCount(0);

    // The original report: "the same tab keeps opening everywhere". Walk the
    // tabs the way a phone does, through the bottom bar, not a fresh load.
    for (const [tab, path] of [
      ["Map", "/map"],
      ["Now", "/tonight"],
      ["Places", "/places"],
      ["Out", "/out"],
      ["Social", "/social"],
      ["You", `/u/${HANDLE}`],
    ]) {
      const link = page.getByRole("link", { name: tab, exact: true }).first();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expectAccountReady(page);
      await expect(identityDialog(page)).toHaveCount(0);
    }
    await capture(page, "returning-2-after-tabs.png");

    // A hard reload discarded the old React-only dismissal. It must stay quiet.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectAccountReady(page);
    await expect(identityDialog(page)).toHaveCount(0);
    await capture(page, "returning-3-after-reload.png");
  });

  test("is welcomed back by name, then left alone", async ({ page }) => {
    await installSession(
      page,
      { complete: false, handle: HANDLE },
      { arrival: "signin", deviceHandle: HANDLE },
    );

    await page.goto("/today", { waitUntil: "domcontentloaded" });
    const welcome = page.getByText(`Welcome back, @${HANDLE}.`);
    await expect(welcome).toBeVisible({ timeout: 10_000 });
    await capture(page, "returning-4-welcome-back.png");
    const selector = page.getByRole("navigation", { name: "Now", exact: true });
    const welcomeSpacing = await selector.boundingBox();

    // A greeting, not a gate: no dialog, and it retires itself.
    await expect(identityDialog(page)).toHaveCount(0);
    await expect(welcome).toBeHidden({ timeout: 15_000 });
    const restingSpacing = await selector.boundingBox();
    expect(welcomeSpacing).not.toBeNull();
    expect(restingSpacing).not.toBeNull();
    expect(restingSpacing!.y).toBeCloseTo(welcomeSpacing!.y, 1);
    await capture(page, "returning-5-welcome-gone.png");
  });

  test("is greeted once, not again on the next page", async ({ page }) => {
    await installSession(
      page,
      { complete: false, handle: HANDLE },
      { arrival: "signin", deviceHandle: HANDLE },
    );
    await page.goto("/today", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/map", { waitUntil: "domcontentloaded" });
    await expectAccountReady(page);
    await expect(page.getByText(`Welcome back, @${HANDLE}.`)).toHaveCount(0);
  });

  for (const { width, founding } of [
    { width: 390, founding: false },
    { width: 1440, founding: false },
    { width: 390, founding: true },
  ]) {
    test(`the ${founding ? "founding " : ""}welcome leaves the Now selector visible and usable by keyboard at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await installSession(
        page,
        { complete: false, handle: HANDLE },
        { arrival: "signin", deviceHandle: HANDLE, foundingMemberNumber: founding ? 1 : undefined },
      );
      await page.goto("/today", { waitUntil: "commit" });

      const welcome = page.locator(".arrivalWelcome");
      const selector = page.getByRole("navigation", { name: "Now", exact: true });
      await expect(welcome).toBeVisible();
      if (founding) await expect(welcome).toHaveAttribute("data-founding", "");
      await expect(selector).toBeVisible();
      await capture(page, "welcome-selector.png");

      const welcomeBox = await welcome.boundingBox();
      const selectorBox = await selector.boundingBox();
      expect(welcomeBox).not.toBeNull();
      expect(selectorBox).not.toBeNull();
      if (!welcomeBox || !selectorBox) throw new Error("Arrival controls must be visible.");
      const overlapWidth = Math.max(0,
        Math.min(welcomeBox.x + welcomeBox.width, selectorBox.x + selectorBox.width) -
        Math.max(welcomeBox.x, selectorBox.x));
      const overlapHeight = Math.max(0,
        Math.min(welcomeBox.y + welcomeBox.height, selectorBox.y + selectorBox.height) -
        Math.max(welcomeBox.y, selectorBox.y));
      const overlap = overlapWidth * overlapHeight;
      await test.info().attach("welcome-selector-geometry", {
        body: JSON.stringify({ welcomeBox, selectorBox, overlap }, null, 2),
        contentType: "application/json",
      });
      expect(overlap, "the welcome must leave both selector labels visible").toBe(0);
      if (width <= 640) {
        const create = page.locator(".createFab");
        await expect(create).toBeVisible();
        const createBox = await create.boundingBox();
        expect(createBox).not.toBeNull();
        expect(welcomeBox.x + welcomeBox.width).toBeLessThanOrEqual(createBox!.x);
      }

      await expect(welcome.getByRole("status")).toHaveAttribute("aria-live", "polite");
      const day = selector.getByRole("link", { name: "Day", exact: true });
      const tonight = selector.getByRole("link", { name: "Tonight", exact: true });
      await day.focus();
      await page.keyboard.press("Tab");
      await expect(tonight).toBeFocused();
      await expect(welcome).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/tonight$/);
    });
  }
});

test.describe("first-timer", () => {
  test("meets a welcome, then one step, never a form pile", async ({ page }) => {
    // A brand-new account: signed in, no handle yet.
    await installSession(page, { complete: false });

    await page.goto("/today", { waitUntil: "domcontentloaded" });
    const sheet = page.locator(".accountOnboarding").first();
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await capture(page, "first-timer-1-welcome.png");

    // Beat one is the place. Beat two is the only thing it cannot start without.
    await expect(sheet.getByText("Welcome to PUBMAXX")).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: "Let's get you in" }),
    ).toBeVisible();
    await expect(sheet.getByText("Your handle", { exact: true })).toBeVisible();
    // ONE RULE (captain, 5 Sep 2026): the date of birth rides beside the name
    // and wears the same Optional tag, so the handle is the one thing asked.
    await expect(
      sheet.getByText("Date of birth Optional", { exact: true }),
    ).toBeVisible();

    // One action, and nothing that offers to skip what was never demanded.
    await expect(sheet.getByRole("button")).toHaveCount(1);
    await expect(sheet.getByText("Skip optional details")).toHaveCount(0);
    await expect(sheet.locator("select")).toHaveCount(0);

    await sheet.locator('input[autocomplete="username"]').fill("newdrinker");
    await sheet.locator('input[type="date"]').fill("1996-04-11");
    await capture(page, "first-timer-2-filled.png");
  });
});

test.describe("the two doors", () => {
  test("sign in and new here read differently on /login", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });

    await page.goto("/login?from=%2Fmap", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Sign in or create your account", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Sign in" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await capture(page, "doors-1-signin.png");

    await page.getByRole("tab", { name: "New here" }).click();
    await expect(
      page.getByRole("heading", { name: "Let's get you in", level: 1 }),
    ).toBeVisible();
    await expect(page).toHaveURL(/mode=signup/);
    await capture(page, "doors-2-signup.png");

    // A direct link opens the right door on first paint.
    await page.goto("/login?mode=signup", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tab", { name: "New here" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
