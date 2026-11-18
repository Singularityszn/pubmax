import { expect, test, type Page } from "@playwright/test";

import { storeThemeChoice } from "./helpers/themeClock";

// The shipped selection is null, so empty Social keeps its general crawl link.
// It reads no crew, prints no places count and offers no other night. The
// adapter tests prove a configured night against the public preview.

async function openSocial(page: Page, theme: "light" | "dark", textScale = 1): Promise<string[]> {
  const crewReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/social/crews/")) crewReads.push(request.url());
  });
  await storeThemeChoice(page, theme);
  await page.addInitScript((scale) => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    if (scale !== 1) {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = `${scale * 100}%`;
      });
    }
  }, textScale);
  await page.goto("/social");
  return crewReads;
}

for (const { width, theme } of [
  { width: 390, theme: "light" },
  { width: 768, theme: "dark" },
  { width: 1440, theme: "light" },
] as const) {
  test(`empty Social at ${width} ${theme} keeps the general crawl link and invents no night`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const crewReads = await openSocial(page, theme);
    const openTable = page.getByRole("region", { name: "Find a crawl to join" });

    await expect(openTable).toBeVisible();
    await expect(openTable.getByRole("link")).toHaveCount(1);
    await expect(openTable.getByRole("link", { name: "Explore open crawls", exact: true })).toHaveAttribute("href", "/crawls");
    await expect(openTable).not.toContainText(/place|said yes|full/i);
    await expect(page.getByRole("link", { name: "View this night" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(crewReads).toEqual([]);
  });
}

test("the general crawl link fits and opens at 200% text", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSocial(page, "dark", 2);
  const explore = page
    .getByRole("region", { name: "Find a crawl to join" })
    .getByRole("link", { name: "Explore open crawls", exact: true });

  await expect(explore).toBeVisible();
  const box = await explore.boundingBox();
  expect(box && box.height >= 44 && box.x + box.width <= 390).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // A tap before hydration can be dropped, so the tap retries until the route moves.
  await expect(async () => {
    await explore.click();
    await expect(page).toHaveURL(/\/crawls$/, { timeout: 2_000 });
  }).toPass();
});
