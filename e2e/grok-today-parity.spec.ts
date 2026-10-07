import { expect, test } from "@playwright/test";

// These pages read the same committed pub suggestions. This keyless check
// proves their rendered parity, not a live event-provider read.
test("Today offers Tonight's sourced pub suggestions and marks the Day segment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 626 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
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
  const suggestions = page.getByTestId("today-picks").getByTestId("tonight-hyped-list");
  await expect(suggestions).toBeVisible();
  expect(await suggestions.getByRole("heading", { level: 3 }).allTextContents()).toEqual(tonightNames);
  expect(await suggestions.locator(".tonightHypedSource").evaluateAll((links) =>
    links.map((link) => ({ label: link.textContent?.trim(), href: link.getAttribute("href") })),
  )).toEqual(tonightCredits);
  await expect(page.getByTestId("today-picks")).not.toContainText("Nothing on tonight's list yet.");
  await expect(page.getByTestId("today-picks").getByRole("link", { name: "See everything on tonight" })).toHaveAttribute("href", "/tonight");
  await expect(page.locator(".createFab")).toBeVisible();
  const coveredText = await page.evaluate(() => {
    const fab = document.querySelector(".createFab")!.getBoundingClientRect();
    const covered: string[] = [];
    for (const row of document.querySelectorAll('.tonightHypedRow, [data-testid="today-weather"]')) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if ([...range.getClientRects()].some((rect) =>
          rect.left < fab.right && rect.right > fab.left &&
          rect.top < fab.bottom && rect.bottom > fab.top,
        )) covered.push(node.textContent.trim());
      }
    }
    return covered;
  });
  expect(coveredText, "Today text covered by the create action").toEqual([]);
  await page.screenshot({ path: "artifacts/today-parity/today-after-phone.png", fullPage: true });
});
