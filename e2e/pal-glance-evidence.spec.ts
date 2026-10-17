import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parseWhatsOnRows } from "../lib/whatsOn";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

for (const width of [390, 1440]) {
  for (const theme of ["light", "dark"]) {
    for (const listings of ["current", "recorded"] as const) {
      test(`${width}px ${theme}: ${listings} summary notes expose scoped evidence and real source doors`, async ({ page }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript((selectedTheme) => {
          localStorage.setItem("pubmax-theme", selectedTheme);
          localStorage.setItem("pubmax-tour-v1-done", "1");
          localStorage.setItem("pubmax_onboarding_dismissed", "1");
          localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
          sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
        }, theme);
        await installDeterministicMapBasemap(page);
        if (listings === "recorded") {
          const now = new Date("2026-10-02T15:00:00.000Z");
          const rows = parseWhatsOnRows(JSON.parse(readFileSync("public/data/whats_on/deals_london.json", "utf8")), now.getTime());
          const deal = rows.find((row) => row.id === "deal-jdw-afternoon-deals-coombe-lodge-croydon");
          expect(deal).toBeDefined();
          await page.clock.setFixedTime(now);
          await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: { rows: [deal], servedAt: now.toISOString() } }));
        }
        const listingResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/whats-on");
        await page.goto("/pal/chat");
        const response = await listingResponse;
        expect(response.status()).toBe(200);
        const body = await response.json();
        expect(Array.isArray(body.rows)).toBe(true);
        const hasListings = body.rows.length > 0;
        const composer = page.getByRole("textbox", { name: "Describe the outing", exact: true });
        const ask = page.getByRole("button", { name: "Ask", exact: true });
        await expect(async () => {
          await composer.fill("Check the sources");
          await expect(ask).toBeEnabled({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        await composer.fill("");
        await expect(ask).toBeDisabled();
        const tonight = page.getByRole("note", { name: "Tonight at a glance", exact: true });
        const price = page.getByRole("note", { name: "Listed price nearby", exact: true });
        await expect(tonight).toBeVisible();
        if (hasListings) {
          await expect(tonight.locator(".palGlanceLine")).toContainText("In our London listings tonight:");
          await expect(tonight.locator(".palGlanceReceipt")).toContainText(/Sources: .+\./);
          await expect(tonight.locator(".palGlanceReceipt")).toContainText(/Oldest listing observed|Listing read date unknown/);
        } else {
          await expect(tonight.locator(".palGlanceLine")).toContainText("No listings in this view tonight.");
          await expect(tonight.locator(".palGlanceReceipt")).toContainText("No listing sources returned.");
          await expect(tonight.getByRole("link", { name: "The map still knows where the cheap pints are.", exact: true })).toHaveAttribute("href", "/map/london");
        }
        if (listings === "recorded") {
          expect(body.rows).toHaveLength(1);
          await expect(tonight.locator(".palGlanceLine")).toHaveText("In our London listings tonight: 1 deal running.");
          await expect(tonight.locator(".palGlanceReceipt")).toContainText("Sources: J D Wetherspoon - Food & drink. Oldest listing observed 2 October 2026.");
        }
        await expect(tonight.getByRole("link", { name: "See listings and sources.", exact: true })).toHaveAttribute("href", "/tonight");
        await expect(price).toContainText("£2.95 at The Three Tuns - LSE Student Union");
        await expect(price.locator(".palGlanceLine")).toContainText(/Lowest listed price|Listed price around/);
        await expect(price.locator(".palGlanceReceipt")).toContainText("Pint Prices");
        await expect(price.locator(".palGlanceReceipt")).toContainText("Source read 2 October 2026");
        await expect(price).toContainText("Serving size, offer and entry terms are not recorded.");
        await price.scrollIntoViewIfNeeded();
        const layout = await price.locator(".palGlanceReceipt").evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, content: element.scrollWidth, available: element.clientWidth, document: document.documentElement.scrollWidth, viewport: innerWidth };
        });
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(width + 1);
        expect(layout.content).toBeLessThanOrEqual(layout.available + 1);
        expect(layout.document).toBeLessThanOrEqual(layout.viewport);
        const venue = price.getByRole("link", { name: "Price source and venue details.", exact: true });
        await expect(venue).toHaveAttribute("href", "/map?sel=venue-p7p18j");
        if (width === 1440 && theme === "light") {
          await venue.scrollIntoViewIfNeeded();
          await expect(async () => {
            await venue.click();
            await expect(page).toHaveURL(/\/map\?sel=venue-p7p18j$/, { timeout: 1_000 });
          }).toPass({ timeout: 20_000 });
          await expect(page.getByRole("tab", { name: "Menu", exact: true })).toBeVisible({ timeout: 45_000 });
          await page.goBack();
          await expect(page).toHaveURL(/\/map$/);
          await expect(page.getByRole("tab", { name: "Menu", exact: true })).toHaveCount(0);
          await page.goBack();
          await expect(page).toHaveURL(/\/pal\/chat$/);
          await expect(tonight).toBeVisible();
          await expect(async () => {
            await composer.fill("Check the sources");
            await expect(ask).toBeEnabled({ timeout: 1_000 });
          }).toPass({ timeout: 20_000 });
          await composer.fill("");
          await expect(ask).toBeDisabled();
          const listingsLink = tonight.getByRole("link", { name: "See listings and sources.", exact: true });
          await listingsLink.scrollIntoViewIfNeeded();
          await expect(async () => {
            await listingsLink.click();
            await expect(page).toHaveURL(/\/tonight$/, { timeout: 1_000 });
          }).toPass({ timeout: 20_000 });
        }
      });
    }
  }
}
