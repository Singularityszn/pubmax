import { expect, test } from "@playwright/test";
import { uiUxChromiumProjectUse } from "../scripts/lib/uiUxBattleTestBrowser.mjs";

test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

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

for (const width of [390, 1440]) {
  test(`Soho answer cards retain their price receipts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/pal/chat");
    const box = page.getByRole("textbox").first();
    await box.fill("Find me four pubs in Soho");
    await box.press("Enter");
    const card = page.locator(".palChatCard").filter({ hasText: "Shakespeares Head" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("£6.25");
    await expect(card).toContainText("Pint Prices. Source read 2 October 2026.");
  });
}

test("the cheapest-pint glance names no walk when nobody shared a location", async ({ page }) => {
  await page.goto("/pal/chat");
  const glance = page.getByRole("note", { name: "Listed price nearby", exact: true });
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
