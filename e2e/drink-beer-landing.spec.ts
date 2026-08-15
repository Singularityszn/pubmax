import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const SHOTS_DIR = path.join(process.cwd(), "docs", "proof", "drink-beer-landing");

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function capture(page: Page, width: 390 | 1440, theme: "light" | "dark") {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.evaluate((value) => {
    document.documentElement.setAttribute("data-theme", value);
    document.querySelectorAll<HTMLElement>("nextjs-portal").forEach((portal) => {
      portal.style.display = "none";
    });
  }, theme);
  await page.waitForTimeout(300);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, `drink-beer-${width}-${theme}.png`),
    fullPage: true,
  });
}

test("beer landing gives one governed price-first answer", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax:analytics-consent:v1", "denied");
  });

  const response = await page.goto("/drink/beer");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Cheapest beer in London",
  );
  await expect(page.locator(".priceLandingRow")).toHaveCount(20);
  await expect(page.locator(".priceLandingPublisher")).toHaveCount(20);
  await expect(page.getByText("Prices last collected 3 July 2026.", { exact: false })).toHaveCount(1);

  const mapLink = page.getByRole("link", { name: "See all beer prices on the map" });
  await expect(mapLink).toHaveAttribute("href", "/map?drink=beer");
  const mapBox = await mapLink.boundingBox();
  const firstVenue = page.locator(".priceLandingVenueLink").first();
  const firstVenueBox = await firstVenue.boundingBox();
  expect(mapBox?.height).toBeGreaterThanOrEqual(44);
  expect(firstVenueBox?.height).toBeGreaterThanOrEqual(44);
  await mapLink.focus();
  await expect(mapLink).toBeFocused();
  await firstVenue.focus();
  await expect(firstVenue).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);

  for (const theme of ["light", "dark"] as const) {
    await capture(page, 390, theme);
    await capture(page, 1440, theme);
  }
});

test("unknown drink landing is not published", async ({ page }) => {
  const response = await page.goto("/drink/not-real");
  expect(response?.status()).toBe(404);
});
