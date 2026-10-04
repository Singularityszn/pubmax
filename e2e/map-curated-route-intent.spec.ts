import { expect, test } from "@playwright/test";

import { curatedCrawls } from "../lib/curatedCrawls";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Public signed-out route. Basemap alone is doubled; the application's curated
// catalog, venue records and price endpoints remain untouched. No offer is
// asserted for these pubs: requested category and unknown money are the contract.
test.use({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
  serviceWorkers: "block",
  storageState: { cookies: [], origins: [] },
});

for (const intent of [
  { query: "routeDrink=vodka", header: "Vodka plan", noun: "vodka stops" },
  { query: "routeLow=1", header: "Alcohol-free plan", noun: "alcohol-free stops" },
]) {
  test(`ordered Soho public route preserves explicit ${intent.query} until native Clear`, async ({ page }, info) => {
    test.setTimeout(90_000);
    const crawl = curatedCrawls.find((candidate) => candidate.id === "victorian-soho");
    expect(crawl, "Committed canonical Soho fixture must exist").toBeDefined();
    if (!crawl) throw new Error("Committed Victorian Soho fixture missing");
    const ids = crawl.venueIds;
    await installDeterministicMapBasemap(page);
    await page.addInitScript(() => {
      localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    // plan=1 opens the existing rail. Public route intent is separate from the
    // map drink lens and need not adopt a matching curated catalog entry.
    const href = `/map?plan=1&mode=build&pubs=${ids.join(",")}&${intent.query}`;
    expect((await page.goto(href))?.status()).toBe(200);
    const panel = page.locator(".routePanel:visible");
    await expect(panel).toHaveCount(1);
    await expect(panel.locator(".routeList > li")).toHaveCount(ids.length);
    await expect.poll(() => new URL(page.url()).searchParams.get("pubs")?.split(",") ?? []).toEqual(ids);
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("pubmax_built_ids");
      return raw ? JSON.parse(raw) : null;
    })).toEqual(ids);
    expect(new URL(page.url()).searchParams.has("drink")).toBe(false);
    await info.attach("actual-public-route", {
      contentType: "application/json",
      body: JSON.stringify({ url: page.url(), canonicalCrawlId: crawl.id, ids,
        header: await panel.locator(".routeHeader").innerText(),
        metrics: await panel.locator(".routeMetrics").innerText(),
        stops: await panel.locator(".routeList").innerText() }, null, 2),
    });

    await expect(panel.locator(".routeHeader h2")).toHaveText(intent.header);
    await expect(panel.locator(".routeMetrics")).toContainText("Not recorded");
    await expect(panel.locator(".routeMetrics")).toContainText(intent.noun);
    await expect(panel.locator(".routeMetrics")).not.toContainText(/£|estimated round|\bpint stops?\b/i);
    await expect(panel.getByRole("radio", { name: "Pint", exact: true })).toHaveCount(0);
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return params.get(intent.query.startsWith("routeLow") ? "routeLow" : "routeDrink");
    }).toBe(intent.query.startsWith("routeLow") ? "1" : "vodka");

    // Each rendered row's native detail action must name the corresponding
    // committed stop. URL/storage order alone would not prove rendered order.
    for (const [index, venueId] of ids.entries()) {
      await panel.locator(".routeList > li").nth(index).locator("button").first().click();
      await expect.poll(() => new URL(page.url()).searchParams.get("sel")).toBe(venueId);
      await page.getByRole("button", { name: "Back to Plan an outing", exact: true }).click();
      await expect(panel).toBeVisible();
    }
    await expect(panel.locator(".routeHeader h2")).toHaveText(intent.header);
    await expect(panel.locator(".routeMetrics")).not.toContainText(/£|estimated round|\bpint stops?\b/i);

    // Real reader replacement still owns the reset; public intent must not
    // survive native Clear or revive through the next ordinary interaction.
    await page.locator(".controlRail:visible").getByRole("button", { name: "Clear", exact: true }).click();
    await expect(panel.locator(".routeList > li")).toHaveCount(0);
    await expect(panel.locator(".routeHeader h2")).toHaveText("Hand-built plan");
    await expect(panel.getByRole("radio", { name: "Pint", exact: true })).toBeVisible();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return ["pubs", "routeDrink", "routeLow"].filter((key) => params.has(key));
    }).toEqual([]);
    expect(new URL(page.url()).searchParams.has("drink")).toBe(false);

    // The existing rail search changes ordinary map filtering, not route intent.
    // This proves empty state through the next interaction, not every possible
    // delayed async callback. No catalog-fetch or artificial settling wait.
    const search = page.locator(".controlRail:visible #railSearchInput");
    await search.fill("Soho");
    await expect(search).toHaveValue("Soho");
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("Soho");
    await expect(panel.locator(".routeList > li")).toHaveCount(0);
    await expect(panel.locator(".routeHeader h2")).toHaveText("Hand-built plan");
    await expect(panel.getByRole("radio", { name: "Pint", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem("pubmax_built_ids");
      return raw ? JSON.parse(raw) : [];
    })).toEqual([]);
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return ["pubs", "routeDrink", "routeLow", "drink"].filter((key) => params.has(key));
    }).toEqual([]);
  });
}
