import { expect, test } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const SEED_VENUE_NAME = "Prospect of Whitby";
const VIEWPORT = { width: 390, height: 844 };
const REAL_AUTH_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a drinker opens the existing price form from the venue action", async ({
  page,
}) => {
  test.skip(REAL_AUTH_CONFIGURED, "Keyless contribution path");
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await sheet
    .getByRole("button", { name: `Add a price at ${SEED_VENUE_NAME}` })
    .click();

  const priceField = sheet.getByRole("textbox", {
    name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
  });
  await expect(priceField).toBeVisible();
  await expect(priceField).toBeFocused();
});

test("desktop venue sheet exposes the same clear price action", async ({
  page,
}) => {
  test.skip(REAL_AUTH_CONFIGURED, "Keyless contribution path");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator(".mapDrawer.right");
  await sheet
    .getByRole("button", { name: `Add a price at ${SEED_VENUE_NAME}` })
    .click();

  await expect(
    sheet.getByRole("textbox", {
      name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
    }),
  ).toBeVisible();
});

test("a real signed-out browser reaches account-first sign-in at the same venue", async ({
  page,
}) => {
  test.skip(
    !REAL_AUTH_CONFIGURED,
    "Requires real public auth configuration, never an intercepted auth response",
  );
  const authConsoleErrors: string[] = [];
  const failedAuthRequests: string[] = [];
  const authSettingsStatuses: number[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /supabase|auth\/v1/i.test(message.text())
    ) {
      authConsoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    if (/supabase|auth\/v1/i.test(request.url())) {
      failedAuthRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/auth/v1/settings")) {
      authSettingsStatuses.push(response.status());
    }
  });
  await page.goto(`/map?sel=${SEED_VENUE_ID}`);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await sheet
    .getByRole("button", { name: `Add a price at ${SEED_VENUE_NAME}` })
    .click();

  const gateHeading = sheet.getByRole("heading", {
    name: "Sign in to add a price",
  });
  await expect(gateHeading).toBeVisible();
  await expect(gateHeading).toBeInViewport();
  await expect(sheet).toContainText(
    `You need an account to add a price. Sign in here and we’ll bring you back to ${SEED_VENUE_NAME}.`,
  );
  await expect(
    sheet.getByRole("textbox", { name: "Continue with email" }),
  ).toBeInViewport();
  await expect(
    sheet.getByRole("button", { name: "Email me a link" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("textbox", {
      name: `Price of a beer at ${SEED_VENUE_NAME}, in pounds`,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(
    new RegExp(`sel=${SEED_VENUE_ID}.*contribute=price`),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.localStorage.getItem(
            "pubmax:price-contribution-intent:v1",
          ),
      ),
    )
    .toContain(SEED_VENUE_ID);
  expect(authSettingsStatuses).toEqual([200]);
  expect(failedAuthRequests).toEqual([]);
  expect(authConsoleErrors).toEqual([]);
});
