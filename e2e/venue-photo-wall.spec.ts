// The pub photo wall in a real browser, at the width most people hold.
//
// Three things only a browser can answer, and they are the three that would each be
// a quiet failure:
//   - the wall does not fetch until its tab is looked at (every panel in the
//     venue sheet renders and the inactive ones are hidden, so an eager wall
//     would pull a page of photos for somebody checking the last train);
//   - a signed-out reader is told how to join in rather than shown a button
//     that will refuse them;
//   - a first tap on the composer in the sheet's bottom band lands where it
//     was aimed.

import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles } from "./helpers/authDoubles";

const SEED_VENUE_ID = "venue-16pnwmm";
const PHONE = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** Every wall read this page has made, in order. */
function watchWallReads(page: Page): string[] {
  const reads: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/venue-photos")) reads.push(url);
  });
  return reads;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax_handle");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function openVenueSheet(page: Page): Promise<void> {
  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);
  await expect(
    page.locator('.mobileSheetPortal[data-sheet-kind="venue"]'),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("status", { name: "Loading the London pub map." }),
  ).toBeHidden({ timeout: 30_000 });
}

test("the wall reads nothing until its tab is opened", async ({ page }) => {
  const errors = watchPageErrors(page);
  const reads = watchWallReads(page);

  await openVenueSheet(page);

  // The panel exists and is hidden. A hidden panel that had already fetched
  // would cost every reader a request they never asked for.
  const panel = page.locator("#venuePanel-photos");
  await expect(panel).toBeHidden();
  expect(reads, "the wall must not read before it is looked at").toEqual([]);

  await page.locator("#venueTab-photos").click();
  await expect(panel).toBeVisible();
  await expect
    .poll(() => reads.length, { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(reads[0]).toContain(`venueId=${SEED_VENUE_ID}`);

  expect(errors).toEqual([]);
});

test("a signed-out reader is told how to join in, not handed a dead button", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await openVenueSheet(page);
  await page.locator("#venueTab-photos").click();

  const wall = page.locator("#venuePanel-photos .venuePhotoWall");
  await expect(wall).toBeVisible();
  await expect(wall.getByRole("heading", { name: "Photo wall" })).toBeVisible();

  // Either the way in or the way to get the way in - never both, and never a
  // button that exists only to refuse.
  const addButton = wall.getByRole("button", { name: "Add a photo" });
  const signInLine = wall.getByText(/Sign in and pick a handle/i);
  await expect
    .poll(async () => (await addButton.count()) + (await signInLine.count()))
    .toBe(1);

  // An empty wall says it is empty, and says so as an invitation.
  const emptyLine = wall.locator(".venuePhotoWallEmpty");
  if (await emptyLine.count()) {
    await expect(emptyLine).toContainText(/first/i);
    // A failed read and an empty pub are two sentences; neither leaks plumbing.
    await expect(emptyLine).not.toContainText(/error|undefined|null|500/i);
  }

  expect(errors).toEqual([]);
});

test("the wall's controls clear the phone's tap-target floor", async ({ page }) => {
  await openVenueSheet(page);
  await page.locator("#venueTab-photos").click();

  const wall = page.locator("#venuePanel-photos .venuePhotoWall");
  await expect(wall).toBeVisible();

  const tab = page.locator("#venueTab-photos");
  const tabBox = await tab.boundingBox();
  expect(tabBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  for (const control of await wall.locator("button").all()) {
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  // Nothing on this panel may push the phone sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

// THE FIRST TAP COUNTS. A first visit mounts the consent card when the venue
// sheet opens, and the sheet hides it. Its focus handler still cleared focused
// controls out of the hidden card's lane, so a tap in the sheet's bottom band
// scrolled the sheet by about 50px between pointerdown and pointerup: the
// share box did not toggle and Post photo did not post until a second tap.
test("a first tap in the sheet's bottom band reaches the share box and Post photo", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchPageErrors(page);
  const posts: string[] = [];
  await page.route("**/api/venue-photos**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ photos: [], nextCursor: null }),
      });
      return;
    }
    posts.push(route.request().method());
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Not in this test." }),
    });
  });
  const stub = await installAuthDoubles(page);
  // A first visit has not answered the consent card yet. This runs after the
  // doubles' own script, which records a refusal.
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
  });
  await page.goto("/");
  await stub.signedInAs("A");
  await openVenueSheet(page);

  const expand = page.getByRole("button", { name: "Expand sheet" });
  if (await expand.isVisible()) await expand.click();
  await page.locator("#venueTab-photos").click();
  const wall = page.locator("#venuePanel-photos .venuePhotoWall");
  await wall.getByRole("button", { name: "Add a photo" }).click();
  await wall.locator("#venue-photo-file").setInputFiles("e2e/fixtures/bill.jpg");
  await wall.getByRole("button", { name: "Use photo" }).click();

  // The defect needs the hidden card mounted; without it this test proves nothing.
  await expect(page.locator(".analyticsConsentPrompt")).toBeAttached();
  await expect(page.locator(".analyticsConsentPrompt")).toBeHidden();

  const body = page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileSharedSheetBody');
  const bodyBox = await body.boundingBox();
  const bandTop = (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0) - 40;

  /** Scroll the sheet the way a thumb does until `control` starts in the bottom band, then tap it. */
  async function tapInBottomBand(control: ReturnType<typeof wall.locator>): Promise<void> {
    await control.evaluate((element, top) => {
      const scroller = element.closest(".mobileSharedSheetBody");
      if (scroller) scroller.scrollTop += element.getBoundingClientRect().top - top;
    }, bandTop);
    const box = await control.boundingBox();
    if (!box) throw new Error("control has no box");
    expect(box.y).toBeGreaterThan(bandTop - 2);
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 10));
  }

  const share = wall.getByRole("checkbox");
  await expect(share).toBeChecked();
  await tapInBottomBand(share);
  await expect(share).not.toBeChecked();

  await tapInBottomBand(wall.getByRole("button", { name: "Post photo" }));
  await expect.poll(() => posts).toEqual(["POST"]);

  expect(errors).toEqual([]);
});
