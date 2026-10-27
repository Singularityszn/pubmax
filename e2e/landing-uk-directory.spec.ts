import { expect, test } from "@playwright/test";

// Compare the rendered homepage with the public pack, rather than importing
// the production count helper as the expected answer.
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`UK directory entry reaches the national map at ${viewport.width} ${theme}`, async ({
      page,
      request,
    }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("pubmax-theme", selectedTheme);
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      }, theme);

      const manifestResponse = await request.get("/data/uk_base/manifest.json");
      expect(manifestResponse.ok()).toBe(true);
      const { generatedFrom } = await manifestResponse.json();
      expect(generatedFrom.pubs).toBeGreaterThan(0);
      expect(generatedFrom.pubs + generatedFrom.unnamed + generatedFrom.bars)
        .toBe(generatedFrom.count);

      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const coverage = page.locator("[data-uk-coverage]");
      await expect(coverage).toContainText(
        `${(generatedFrom.pubs + generatedFrom.unnamed).toLocaleString("en-GB")} UK pub listings`,
      );
      await expect(coverage).toContainText(
        `${generatedFrom.bars.toLocaleString("en-GB")} bar listings from OpenStreetMap`,
      );
      await expect(coverage).toContainText("A listing doesn't mean we have its prices or know it's open.");

      // The UK catalogue cannot replace the smaller priced London cohort.
      const londonSample = page.locator(".lpWorth .lpSavingSummary")
        .filter({ hasText: /priced London pubs/ });
      await expect(londonSample).toHaveCount(1);
      await expect(londonSample).toContainText(/cheapest listed pint across [\d,]+ priced London pubs/);

      const entry = page.getByRole("link", { name: "Browse pubs across the UK", exact: true });
      await expect(entry).toHaveAttribute("href", "/map?uk=1");
      await entry.scrollIntoViewIfNeeded();
      await expect(coverage).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("uk-directory.png") });

      await entry.click();
      await expect(page).toHaveURL(/\/map\?uk=1$/);
      const ukNote = page.getByRole("complementary", { name: "UK pub map", exact: true });
      await expect(ukNote).toBeVisible({ timeout: 45_000 });
      await expect(ukNote).toContainText("Zoom in to load pubs on the map.");
      await page.screenshot({ path: testInfo.outputPath("uk-map-arrival.png") });
    });
  }
}

test("About separates the UK directory from price coverage", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.goto("/about");
  const disclosure = page.getByText("Sources, confirmation and coverage", { exact: true });
  await disclosure.click();
  const coverage = page.getByRole("listitem").filter({ hasText: "Coverage varies by city." });
  await expect(coverage).toContainText(/UK directory has [\d,]+ pub listings and [\d,]+ bar listings from OpenStreetMap/);
  await expect(coverage).toContainText("A listing doesn’t mean we have its prices or know it’s open.");
  await expect(coverage.getByRole("link", { name: "Browse pubs across the UK", exact: true }))
    .toHaveAttribute("href", "/map?uk=1");
});
