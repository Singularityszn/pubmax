import { expect, test } from "@playwright/test";

// These pages read the same committed pub suggestions. This keyless check
// proves their rendered parity, not a live event-provider read.
test("Today is the day page: none of Tonight's suggestions, and the Day segment marked", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 626 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    // The consent card owns the create action's lane, so the action stands
    // down until it is answered. Answer it, as the config's returning visitor.
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
  await expect(page.locator(".createFab")).toBeVisible();
  const coveredText = await page.evaluate(() => {
    const fab = document.querySelector(".createFab")!.getBoundingClientRect();
    const covered: string[] = [];
    for (const row of document.querySelectorAll('.tonightHypedRow, [data-testid="today-weather"]')) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim()) continue;
        // A screen-reader label has glyph bounds even when CSS clips all ink.
        // Its range cannot prove that the floating action covers visible text.
        let parent = node.parentElement;
        let clipped = false;
        while (parent && parent !== row.parentElement) {
          const style = getComputedStyle(parent);
          if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") {
            clipped = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (clipped) continue;
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
  await page.screenshot({ path: test.info().outputPath("today-after-phone.png"), fullPage: true });
});
