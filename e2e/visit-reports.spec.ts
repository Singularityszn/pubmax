import { expect, test, type Page } from "@playwright/test";

const SEED_VENUE_ID = "venue-16pnwmm";
const VIEWPORT = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmax_handle");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("a visit account can be written and read back from a 390px venue sheet", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const account = `Back room was calm after nine ${Date.now()}`.slice(0, 140);

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("status", { name: "Loading the London pub map." }),
  ).toBeHidden({ timeout: 30_000 });
  await page.locator("#venueTab-story").click();

  const story = page.locator("#venuePanel-story");
  await expect(story).toBeVisible();
  const lane = story.locator(".visitReportPanel");
  await expect(lane).toBeVisible();
  await lane.getByRole("button", { name: "Write yours" }).click();

  const date = lane.getByLabel("When were you there?");
  await expect(date).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);

  for (const choice of ["Steady", "Easy to talk", "Plenty", "Quick"]) {
    const chip = lane.getByRole("button", { name: choice, exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `${choice} chip height`).toBeGreaterThanOrEqual(44);
    await chip.click();
  }

  await lane.getByLabel("One short account").fill(account);
  await lane.getByLabel("Your contributor handle").fill("visit_lane_test");
  const submit = lane.getByRole("button", { name: "Add visit account" });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await submit.click();

  await expect(lane.getByText("Saved. Your visit is on this pub's page.")).toBeVisible();
  const first = lane.locator(".visitReportRow").first();
  await expect(first).toContainText(account);
  await expect(first).toContainText("@visit_lane_test");
  await expect(first).toContainText("Visited");
  await expect(first).toContainText("Crowd: steady");
  await expect(first).toContainText("Noise: easy to talk");

  expect(await lane.locator('[aria-label*="star" i], .starRating').count()).toBe(0);
  const fits = await lane.evaluate(
    (element) => element.scrollWidth <= element.clientWidth + 1,
  );
  expect(fits).toBe(true);
  expect(errors).toEqual([]);
});
