import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const SHOTS_DIR = path.join(process.cwd(), "docs", "proof", "night-area-landing");

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function capture(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => {
    document.documentElement.setAttribute("data-theme", value);
    document.querySelectorAll<HTMLElement>("nextjs-portal").forEach((portal) => {
      portal.style.display = "none";
    });
  }, theme);
  await page.waitForTimeout(300);
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS_DIR, `clapham-390-${theme}.png`),
    fullPage: true,
  });
}

test("Clapham gives a governed publisher-backed price answer", async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax:analytics-consent:v1", "denied");
  });

  const response = await page.goto("/area/clapham");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Cheapest pints in Clapham",
  );
  await expect(page.locator(".priceLandingRow")).toHaveCount(10);
  await expect(page.locator(".priceLandingPublisher")).toHaveCount(10);
  await expect(
    page.getByText("Prices last collected 3 July 2026.", { exact: false }),
  ).toHaveCount(1);

  const mapLink = page.getByRole("link", { name: "See Clapham on the map" });
  await expect(mapLink).toHaveAttribute("href", "/map?q=Clapham");
  const firstVenue = page.locator(".priceLandingVenueLink").first();
  expect((await mapLink.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect((await firstVenue.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await firstVenue.focus();
  await expect(firstVenue).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);

  await capture(page, "light");
  await capture(page, "dark");
});

test("an ungoverned Night Area is not published", async ({ page }) => {
  const response = await page.goto("/area/camden");
  expect(response?.status()).toBe(404);
});
