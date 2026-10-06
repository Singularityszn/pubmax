import { expect, test, type Page } from "@playwright/test";

// Handle + password, both halves.
//
// WHAT THIS CAN AND CANNOT REHEARSE: setting a password is the browser's own
// call to GoTrue, so Playwright can route it. Signing in with handle and
// password is our route calling GoTrue from the SERVER, which no browser route
// reaches. So the sign-in half is rehearsed at its refusal (the one thing a
// signed-out person actually meets when they have no password yet) and the
// grant itself stays pinned in __tests__/handlePasswordRoute.test.ts.

const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000c";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const HANDLE = "passwordproof";

const GENERIC_ERROR = "Handle or password is wrong.";
const GUIDANCE =
  "No password yet? Sign in with your email link and create one from your profile.";
const HINT =
  "At least 8 characters, with one capital letter, one number and one special character.";

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId }) => {
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
            email: "password-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-08-01T00:00:00.000Z",
          },
        }),
      );
    },
    { authStorageKey: E2E_AUTH_STORAGE_KEY, userId: E2E_AUTH_USER_ID },
  );
}

/** Signed in, handle claimed, and the account has no password yet. */
async function installOwnedAccount(
  page: Page,
  options: { hasPassword: boolean | null },
): Promise<{ passwordWrites: number }> {
  const counters = { passwordWrites: 0 };
  await seedSignedInSession(page);

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    const request = route.request();
    // `updateUser({ password })` is a PUT to GoTrue's own user endpoint. It is
    // the ONLY way a password is ever set: no route of ours is in this path.
    if (
      request.method() === "PUT" &&
      request.url().includes("/auth/v1/user") &&
      (request.postData() ?? "").includes("password")
    ) {
      counters.passwordWrites += 1;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "password-e2e@example.test",
      }),
    });
  });

  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        complete: true,
        handle: HANDLE,
        dateOfBirth: "1995-06-15",
      }),
    });
  });

  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: HANDLE,
        foundingMemberNumber: null,
        // The server answers true once the owner has set one (0173), and the
        // hub reads it again when GoTrue reports the updated user.
        hasPassword: counters.passwordWrites > 0 ? true : options.hasPassword,
      }),
    });
  });

  return counters;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a refused handle sign-in says nothing, and still says the way out", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/handle-password", async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: GENERIC_ERROR, code: "INVALID_CREDENTIALS" }),
    });
  });

  await page.goto("/login");
  await page
    .getByRole("button", { name: "Sign in with handle and password" })
    .click();

  const form = page.getByRole("form", {
    name: "Sign in with handle and password",
  });
  const handleField = form.getByLabel("Handle");

  // iOS capitalises the first letter of a text field by default, and a handle
  // is lower case. The field must not fight it.
  await expect(handleField).toHaveAttribute("autocapitalize", "none");

  // Typed in the wrong case on purpose: the server normalizes.
  await handleField.fill("PasswordProof");
  await form.getByLabel("Password").fill("Wrongpass1!");
  await form.getByRole("button", { name: "Sign in" }).click();

  await expect(form.getByRole("alert")).toHaveText(GENERIC_ERROR);
  await expect(form.getByText(GUIDANCE)).toBeVisible();
  expect(attempts).toBe(1);
});

test("an account with no password is offered one, with the rules up front", async ({
  page,
}) => {
  const counters = await installOwnedAccount(page, { hasPassword: false });

  await page.goto(`/u/${HANDLE}`);
  const section = page.locator("form.accountHubPassword");
  await expect(
    section.getByRole("heading", { name: "Create password" }),
  ).toBeVisible();
  // Owed, so it takes the full row rather than sitting in a column.
  await expect(section).toHaveClass(/accountHubPasswordOwed/);

  // The rules are read BEFORE typing, not discovered by failing.
  await expect(section.getByText(HINT)).toBeVisible();

  const field = section.getByLabel("Password", { exact: true });
  await field.fill("pubmaxxx");
  await expect(section.locator('li[data-rule="length"]')).toHaveAttribute(
    "data-met",
    "yes",
  );
  await expect(section.locator('li[data-rule="capital"]')).toHaveAttribute(
    "data-met",
    "no",
  );

  // A password that misses a rule never leaves the browser.
  await section.getByLabel("Confirm password").fill("pubmaxxx");
  await section.getByRole("button", { name: "Save password" }).click();
  await expect(section.getByRole("alert")).toContainText("8 characters");
  expect(counters.passwordWrites).toBe(0);

  await field.fill("Pubmaxx1!");
  await expect(section.locator('li[data-met="no"]')).toHaveCount(0);
  await section.getByLabel("Confirm password").fill("Pubmaxx1!");
  await section.getByRole("button", { name: "Save password" }).click();

  // The card becomes the change disclosure, opened once so the confirmation
  // is read rather than folded away.
  const disclosure = page.locator("details.accountHubPasswordChange");
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByRole("status")).toBeVisible();
  await expect(disclosure.getByRole("status")).toContainText("Password saved");
  expect(counters.passwordWrites).toBe(1);
});

test("an account with a password keeps change collapsed until opened", async ({
  page,
}) => {
  await installOwnedAccount(page, { hasPassword: true });

  await page.goto(`/u/${HANDLE}`);
  const disclosure = page.locator("details.accountHubPasswordChange");
  await expect(disclosure).toHaveCount(1);
  await expect(disclosure.locator("form.accountHubPassword")).toHaveCount(1);
  await expect(disclosure.locator("form.accountHubPassword")).toBeHidden();
  await expect(disclosure).not.toHaveAttribute("open", "");
  await expect(disclosure.getByLabel("Current password")).toBeHidden();
  await expect(disclosure.getByLabel("New password")).toBeHidden();
  await expect(disclosure.getByLabel("Confirm password")).toBeHidden();

  await disclosure.locator("summary").click();

  await expect(disclosure).toHaveAttribute("open", "");
  await expect(disclosure.getByLabel("Current password")).toBeVisible();
  await expect(disclosure.getByLabel("New password")).toBeVisible();
  await expect(disclosure.getByLabel("Confirm password")).toBeVisible();
});

test("a read that could not answer names neither state", async ({ page }) => {
  await installOwnedAccount(page, { hasPassword: null });

  await page.goto(`/u/${HANDLE}`);
  await expect(page.locator(".accountHubPassword")).toHaveCount(0);
  await expect(page.getByText("Create password", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Change password", { exact: true })).toHaveCount(0);
});

test("the create-password ask rests above the tab bar, so its buttons can be tapped", async ({
  page,
}) => {
  await installOwnedAccount(page, { hasPassword: false });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
  });

  await page.goto("/tonight");
  const card = page.getByRole("dialog", { name: "Add a password?" });
  await expect(card).toBeVisible();

  const [cardBox, barBox] = await Promise.all([
    card.boundingBox(),
    page.locator(".mobileTabBar").boundingBox(),
  ]);
  expect(cardBox).not.toBeNull();
  expect(barBox).not.toBeNull();
  // The card ends above the bar's top edge rather than under it.
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(barBox!.y + 1);

  // And the answer is reachable: the topmost element at the button's centre is
  // the button itself, not a tab.
  const accept = card.getByRole("link", { name: "Add one" });
  const acceptBox = (await accept.boundingBox())!;
  const topmostIsAccept = await accept.evaluate(
    (el, point) => el.contains(document.elementFromPoint(point.x, point.y)),
    { x: acceptBox.x + acceptBox.width / 2, y: acceptBox.y + acceptBox.height / 2 },
  );
  expect(topmostIsAccept).toBe(true);
});

test("a wrong current password and a reused password each name their fault", async ({ page }) => {
  await installOwnedAccount(page, { hasPassword: true });
  await page.route("**/api/auth/change-password/verify", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { currentPassword?: string };
    if (body.currentPassword === "Right1pass!") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ verified: true }),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Could not change your password. Try again.",
        code: "INVALID_CREDENTIALS",
      }),
    });
  });
  // GoTrue's answer to a new password that equals the current one.
  await page.route("https://pubmaxx-e2e.supabase.co/auth/v1/user", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          code: 422,
          error_code: "same_password",
          msg: "New password should be different from the old password.",
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/u/${HANDLE}`);
  const disclosure = page.locator("details.accountHubPasswordChange");
  await disclosure.locator("summary").click();
  // The summary names the form once: no second heading repeats it.
  await expect(disclosure.getByRole("heading", { name: "Change password" })).toHaveCount(0);

  const form = disclosure.locator("form.accountHubPassword");
  await form.getByLabel("New password").fill("Pubmaxx1!");
  await form.getByLabel("Confirm password").fill("Pubmaxx1!");

  await form.getByLabel("Current password").fill("Wrong1pass!");
  await form.getByRole("button", { name: "Save password" }).click();
  await expect(form.getByRole("alert")).toHaveText("That is not your current password.");

  await form.getByLabel("Current password").fill("Right1pass!");
  await form.getByRole("button", { name: "Save password" }).click();
  await expect(form.getByRole("alert")).toHaveText(
    "That is your current password. Pick a different one.",
  );
});

test("the create action steps aside on the profile page it used to cover", async ({ page }) => {
  await installOwnedAccount(page, { hasPassword: true });
  await page.goto(`/u/${HANDLE}`);
  await expect(page.getByRole("heading", { name: "Your diary" })).toBeVisible();
  // The floating + sat over the Pint Passport hero and the diary date at 390.
  await expect(page.locator(".createFabRoot")).toBeHidden();
});
