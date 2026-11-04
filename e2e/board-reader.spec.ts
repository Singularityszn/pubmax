import { expect, test, type Page } from "@playwright/test";

import { BOARD_READ_ACTION, BOARD_READ_KEYLESS_LINE } from "../lib/boardRead";
import { stubSocialAuthProviders } from "./helpers/authDoubles";
import { expectMobileMapShellReady } from "./helpers/mobileMapShell";
import {
  COMMUNITY_SHEET_FIXTURE_MAP_PATH,
  COMMUNITY_SHEET_FIXTURE_VENUE_ID,
  COMMUNITY_SHEET_FIXTURE_VENUE_NAME,
} from "./helpers/communitySheetFixture";

// The board reader (round 5 A4) from the venue sheet, keyless.
//
// KEYLESS ONLY. The reader needs OPENROUTER_API_KEY on the server
// (lib/boardRead.server.ts#boardReaderKeyed). With no key the page says one
// line and offers no control, and that is the state this spec holds. The keyed
// half (choose a photo, the Pal proposes rows, the drinker confirms each row)
// needs the key and a model answer, so no browser spec drives it here.
//
// The pub is the community sheet fixture (e2e/helpers/communitySheetFixture.ts),
// the venue the other venue-sheet specs open.

const WIDTHS = [390, 1280] as const;
const BOARD_PATH = `/board/${COMMUNITY_SHEET_FIXTURE_VENUE_ID}`;

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
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

/** The keyless board page: the pub's name, the one line, and no write control. */
async function expectKeylessBoard(page: Page): Promise<void> {
  const screen = page.locator(".boardScreen");
  await expect(
    screen.getByRole("heading", { name: COMMUNITY_SHEET_FIXTURE_VENUE_NAME, level: 1 }),
  ).toBeVisible();
  await expect(screen.getByText(BOARD_READ_ACTION, { exact: true })).toBeVisible();
  await expect(screen.getByRole("status")).toHaveText(BOARD_READ_KEYLESS_LINE);
  // Nothing on the page can write: no photo picker, no confirm box, no button.
  await expect(
    screen.locator(
      "button:enabled, input:enabled, textarea:enabled, select:enabled, [role=button]:not([aria-disabled=true])",
    ),
  ).toHaveCount(0);
  await expect(page.locator(".boardReader")).toHaveCount(0);
}

for (const width of WIDTHS) {
  test(`"${BOARD_READ_ACTION}" on the venue sheet opens the keyless board page at ${width}px`, async ({
    page,
  }) => {
    test.slow();
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });

    const response = await page.goto(COMMUNITY_SHEET_FIXTURE_MAP_PATH);
    expect(response?.status()).toBe(200);
    if (width === 390) await expectMobileMapShellReady(page);

    const door = page.getByTestId("board-reader-door").filter({ visible: true });
    await expect(door).toBeVisible({ timeout: 60_000 });
    await expect(door).toHaveText(BOARD_READ_ACTION);
    await expect(door).toHaveAttribute("href", BOARD_PATH);

    // The sheet is painted on the client: retry the tap, not the wait after it.
    // Retry it only while the page is still the map: the board page renders
    // per request, so the first good tap can take a few seconds to land.
    const onBoard = new RegExp(`${BOARD_PATH}$`);
    await expect(async () => {
      if (!onBoard.test(page.url())) await door.click({ timeout: 2_000 });
      await expect(page).toHaveURL(onBoard, { timeout: 5_000 });
    }).toPass({ timeout: 45_000 });

    await expectKeylessBoard(page);
    expect(errors).toEqual([]);
  });
}

test("the board page opened directly says the keyless line and holds no write control", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto(BOARD_PATH);
  expect(response?.status()).toBe(200);
  await expectKeylessBoard(page);
  expect(errors).toEqual([]);
});
