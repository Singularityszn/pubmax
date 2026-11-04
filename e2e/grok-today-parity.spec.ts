import { expect, test } from "@playwright/test";

// These pages read the same committed pub suggestions. This keyless check
// proves their rendered parity, not a live event-provider read.
test("Today is the day page: none of Tonight's suggestions, and the Day segment marked", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 626 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Answer the consent card, as the config's returning visitor.
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
  });
  await page.goto("/tonight");
  const tonightSuggestions = page.getByTestId("tonight-hyped-list");
  await expect(tonightSuggestions).toBeVisible();
  const tonightNames = await tonightSuggestions.getByRole("heading", { level: 3 }).allTextContents();
  const tonightCredits = await tonightSuggestions.locator(".tonightHypedSource").evaluateAll((links) =>
    links.map((link) => ({ label: link.textContent?.trim(), href: link.getAttribute("href") })),
  );

  await expect(async () => {
    await page.getByRole("navigation", { name: "Now", exact: true }).getByRole("link", { name: "Day", exact: true }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  const now = page.getByRole("navigation", { name: "Now", exact: true });
  await expect(now.getByRole("link", { name: "Day", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(now.getByRole("link", { name: "Tonight", exact: true })).not.toHaveAttribute("aria-current", "page");
  // Launch review, 30 Oct 2026 (design V1): the day page repeats none of
  // Tonight's picks or recommended pubs.
  await expect(page.getByTestId("today-picks")).toHaveCount(0);
  await expect(page.getByTestId("tonight-hyped-list")).toHaveCount(0);
  for (const name of tonightNames) {
    await expect(page.getByRole("heading", { level: 3, name, exact: true })).toHaveCount(0);
  }
  expect(tonightCredits.length).toBeGreaterThan(0);
  // The floating create action that used to stand over these cards left with
  // the five-tab dock (captain, 1 Nov 2026).
  await expect(page.locator(".createFab, .createFabRoot")).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("today-after-phone.png"), fullPage: true });
});
