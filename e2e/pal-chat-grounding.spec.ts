import { expect, test } from "@playwright/test";

// The Pal chat's claims have to match what the app knows. With no location
// shared, the cheapest-pint glance measured from the middle of the area and
// still said "about 11 min on foot", and a question that named Blackfriars was
// answered with "No area set".

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("the cheapest-pint glance names no walk when nobody shared a location", async ({ page }) => {
  await page.goto("/pal/chat");
  const glance = page.getByText(/^Cheapest round /);
  await expect(glance).toBeVisible();
  await expect(glance).toContainText(/£\d+\.\d\d at /);
  await expect(glance).not.toContainText("on foot");
});

test("a named place the gazetteer cannot place is said so, not called no area", async ({ page }) => {
  await page.goto("/pal/chat");
  const box = page.getByRole("textbox").first();
  await box.fill("Two cheap pubs in Blackfriars for a quiet pint");
  await box.press("Enter");
  const line = page.getByText(/^Across London\./);
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(line).toContainText("Blackfriars");
  await expect(line).not.toContainText("No area set");
});
