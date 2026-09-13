import { expect, test } from "@playwright/test";

// The route-end "Check last train" door asks the sheet for the getting-home
// fold on the Overview. When the final stop is already open on another tab,
// the request still has to land: on the Overview, with the fold open. A second
// tap after the reader closes the fold opens it again.

const FIRST_STOP = "venue-yl1a48";
const FINAL_STOP = "venue-1vle947";

test("desktop: Check last train on the open final stop lands on Overview with the fold open", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto(
    `/map?mode=build&pubs=${FIRST_STOP}%2C${FINAL_STOP}&sel=${FINAL_STOP}`,
  );
  expect(response?.status()).toBe(200);

  const inspector = page.locator(".venueInspector").filter({ visible: true }).first();
  await expect(inspector).toBeVisible({ timeout: 60_000 });

  const lore = inspector.getByRole("tab", { name: "Lore", exact: true });
  await expect(async () => {
    await lore.click();
    await expect(lore).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(inspector.locator("#venuePanel-story")).toBeVisible();

  const door = page
    .getByRole("button", { name: "Check last train at final stop" })
    .filter({ visible: true })
    .first();
  await door.click();

  await expect(inspector.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const fold = inspector.locator("#venueSection-getting-home");
  await expect(fold).toHaveAttribute("open", "");
  await expect(fold.getByLabel("Last Pint")).toBeVisible();

  await fold.locator("summary").click();
  await expect(fold).not.toHaveAttribute("open", "");
  await door.click();
  await expect(fold).toHaveAttribute("open", "");
});
