import { expect, test, type Page } from "@playwright/test";

import { stubSocialAuthProviders } from "./helpers/authDoubles";
import { expectMobileMapShellReady } from "./helpers/mobileMapShell";
import { COMMUNITY_SHEET_FIXTURE_MAP_PATH } from "./helpers/communitySheetFixture";

// Mates' prices on the venue sheet (round 5 F8), signed out.
//
// The block reads what the reader's mutual friends last paid, so it exists
// only for a signed-in reader with mutuals who logged here. Signed out, the
// sheet carries no "Your mates paid" block, no empty frame, and makes no read
// of /api/mates-prices at all. The signed-in block is held by
// __tests__/matesPricesLine.test.tsx and __tests__/matesPricesRoute.test.ts;
// a browser run would need a seeded friendship and a logged drop, which the
// keyless store does not hold.
//
// The block renders no data attribute; its section carries the class
// `matesPrices` and the heading "Your mates paid" (components/map/MatesPricesLine.tsx).

const WIDTHS = [390, 1280] as const;

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await stubSocialAuthProviders(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax_handle");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

for (const width of WIDTHS) {
  test(`signed out, the venue sheet shows no "Your mates paid" block at ${width}px`, async ({
    page,
  }) => {
    test.slow();
    const errors = watchPageErrors(page);
    const matesReads: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/mates-prices")) matesReads.push(request.url());
    });
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });

    const response = await page.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
    expect(response?.status()).toBe(200);
    if (width === 390) await expectMobileMapShellReady(page);

    // The block mounts beside the board door in the Overview tab, so the door
    // being up means the block has had its render.
    await expect(page.getByTestId("board-reader-door").filter({ visible: true })).toBeVisible({
      timeout: 60_000,
    });
    // The signed-out door on the sheet is settled, so the session is known.
    await expect(
      page.getByRole("button", { name: /Log (tonight's|a) price|Add a price/i }).filter({ visible: true }).first(),
    ).toBeVisible();

    await expect(page.locator(".matesPrices")).toHaveCount(0);
    await expect(page.locator(".matesPricesFact")).toHaveCount(0);
    await expect(page.getByText("Your mates paid", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your mates paid" })).toHaveCount(0);
    expect(matesReads, "a signed-out sheet must not read mates' prices").toEqual([]);

    expect(errors).toEqual([]);
  });
}
