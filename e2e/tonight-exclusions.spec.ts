import { expect, test } from "@playwright/test";
import type { WhatsOnRow } from "../lib/whatsOn";

// Oracle: F6/F6b requires a 24-hour source check, independent feed dates,
// and exclusion explanations even when Out cannot answer. These fixtures
// exercise the production page, including its real fetch hooks and merge.
const NOW = "2026-10-25T12:00:00Z";
const FRESH = "2026-10-25T11:00:00Z";
const STALE = "2026-10-07T12:00:00Z";
const cask: WhatsOnRow = {
  id: "cask-bluegrass", venueId: "venue-pzbwmw", placeName: "Cask",
  kind: "music", title: "Bluegrass", startsAt: "2026-10-25T16:30:00Z",
  observedAt: STALE, confidence: "listed",
  source: { label: "Cask", url: "https://example.com/bluegrass" },
};
const outReady = {
  status: "ready", listingsStatus: "ready", venueMatch: "ready", events: [],
  observedAt: { ticketmaster: FRESH }, providers: [], attribution: [], openPlans: [],
};
const staleLine = "1 pub listing hidden: its source check is older than 24 hours.";

for (const width of [1440, 390]) {
  for (const scenario of [
    "stale", "invalid row date", "stale with invalid row date", "separate feed dates",
    "undated deal", "mixed", "24-hour boundary", "past and unmatched",
    "duplicates stale-first", "duplicates fresh-first", "Out duplicate",
    "Out timeout", "Out degraded", "Out unavailable",
  ]) {
    test(`${scenario} preserves Tonight source honesty at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.clock.setFixedTime(new Date(NOW));
      // Only this disposable loopback product may receive browser requests.
      await page.route("**/*", (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname !== "localhost" || request.method() !== "GET") return route.abort();
        return route.continue();
      });
      let rows: WhatsOnRow[] = [cask];
      let kindObservedAt: Record<string, string> = { music: STALE };
      let out: Record<string, unknown> = { ...outReady };
      if (scenario === "invalid row date" || scenario === "stale with invalid row date") {
        const undated = { ...cask, id: "undated-music", venueId: "venue-xjf3n0", placeName: "The Dove",
          title: "Undated concert", observedAt: "not-a-date" };
        rows = scenario === "invalid row date" ? [undated] : [cask, undated];
        kindObservedAt = {};
      }
      if (scenario === "separate feed dates") {
        rows = [{ ...cask, observedAt: "2026-10-24T13:00:00Z" }];
        kindObservedAt = { music: "2026-10-24T13:00:00Z" };
      }
      if (scenario === "undated deal") {
        rows = [{ ...cask, kind: "deal", title: "Sunday food offer", observedAt: FRESH }];
        kindObservedAt = {};
      }
      if (scenario === "mixed") {
        rows = [cask, {
          ...cask, id: "undated-deal", venueId: "venue-xjf3n0", placeName: "The Deal Arms",
          kind: "deal", title: "Sunday food offer", observedAt: FRESH,
          source: { label: "Pub website", url: "https://example.com/food" },
        }];
        kindObservedAt = { music: STALE }; // No provider date for the displayed deal.
      }
      if (scenario === "24-hour boundary") {
        rows = [
          { ...cask, title: "Exactly 24 hours", observedAt: "2026-10-24T12:00:00Z" },
          { ...cask, id: "expired", venueId: "venue-xjf3n0", title: "One millisecond too old", observedAt: "2026-10-24T11:59:59.999Z" },
        ];
        kindObservedAt = { music: "2026-10-24T12:00:00Z" };
      }
      if (scenario === "past and unmatched") rows = [
        cask,
        { ...cask, id: "past", title: "Finished concert", startsAt: "2026-10-24T16:30:00Z" },
        { ...cask, id: "unmatched", venueId: undefined, title: "Unmatched concert" },
      ];
      if (scenario.startsWith("duplicates")) {
        const fresh = { ...cask, observedAt: FRESH };
        rows = scenario.endsWith("stale-first") ? [cask, cask, fresh] : [fresh, cask, cask];
        kindObservedAt = { music: FRESH };
      }
      if (scenario === "Out duplicate") out = {
        ...outReady, events: [{ ...cask, observedAt: FRESH,
          source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/fixture" } }],
      };
      if (scenario === "Out degraded") out = { ...outReady, status: "degraded", listingsStatus: "degraded" };
      if (scenario === "Out unavailable") out = { ...outReady, venueMatch: "unavailable" };
      await page.route("**/api/whats-on?**", (route) => route.fulfill({ json: {
        rows, readStatus: "ready", servedAt: NOW, sourceObservedAt: null,
        sourceFreshnessKind: "provider-observed", kindObservedAt, localityBasis: "london-default",
      } }));
      await page.route("**/api/out?**", (route) => scenario === "Out timeout"
        ? undefined // Let the real hook reach its eight-second abort deadline.
        : route.fulfill({ json: out }));
      await page.goto("/tonight");
      const exclusions = page.locator('[data-tonight-provenance="excluded-whats-on"]');
      const whatsOn = page.locator('[data-tonight-provenance="whats-on"]');
      const outCredit = page.locator('[data-tonight-provenance="out"]');
      if (scenario === "invalid row date" || scenario === "stale with invalid row date") {
        // The What's-On wire contract requires a valid observedAt. Malformed
        // rows are rejected by the real hook before listing credits are built.
        if (scenario === "invalid row date") {
          await expect(page.locator('[data-tonight-provenance="undated-whats-on"]'))
            .toContainText("The pub listings source check date is not recorded.");
          await expect(exclusions).toHaveCount(0);
        } else {
          await expect(exclusions).toHaveText(staleLine);
          await expect(page.locator('[data-tonight-provenance="undated-whats-on"]')).toHaveCount(0);
        }
        await expect(page.getByRole("heading", { name: "Undated concert", exact: true })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Bluegrass", exact: true })).toHaveCount(0);
        await expect(outCredit).toHaveText("No pub-matched events via Ticketmaster · Checked 25 Oct");
      } else if (scenario === "separate feed dates") {
        await expect(page.getByRole("heading", { name: "Bluegrass", exact: true })).toBeVisible();
        await expect(whatsOn).toContainText("Checked 24 Oct");
        await expect(whatsOn).not.toContainText("Checked 25 Oct");
        await expect(outCredit).toHaveText("No pub-matched events via Ticketmaster · Checked 25 Oct");
        await expect(exclusions).toHaveCount(0);
      } else if (scenario.startsWith("duplicates") || scenario === "Out duplicate") {
        const listing = scenario === "Out duplicate"
          ? page.locator('[aria-labelledby="music-tonight-title"]').getByText("Bluegrass", { exact: true })
          : page.getByRole("heading", { name: "Bluegrass", exact: true });
        await expect(listing).toHaveCount(1);
        await expect(exclusions).toHaveCount(0);
        const credit = scenario === "Out duplicate" ? outCredit : whatsOn;
        await expect(credit).toContainText("1 listing");
        await expect(credit).toContainText("Checked 25 Oct");
      } else if (scenario === "undated deal") {
        await expect(page.getByRole("heading", { name: "Sunday food offer", exact: true })).toBeVisible();
        await expect(whatsOn).toContainText("The pub listings source check date is not recorded.");
        await expect(whatsOn).not.toContainText("Checked");
        await expect(exclusions).toHaveCount(0);
      } else {
        await expect(exclusions).toHaveText(staleLine);
        await expect(page.getByRole("heading", { name: "Bluegrass", exact: true })).toHaveCount(0);
        if (["Out timeout", "Out degraded", "Out unavailable"].includes(scenario)) {
          await expect(page.locator(".tonightPrimary")).toHaveAttribute("data-status", "error", { timeout: 15_000 });
          await expect(exclusions).toBeVisible();
          await expect(whatsOn).toHaveCount(0);
          await expect(outCredit).toHaveCount(0);
        } else {
          await expect(outCredit).toHaveText("No pub-matched events via Ticketmaster · Checked 25 Oct");
          if (scenario === "mixed") {
            await expect(page.getByRole("heading", { name: "Sunday food offer", exact: true })).toBeVisible();
            await expect(whatsOn).toContainText("The pub listings source check date is not recorded.");
            await expect(whatsOn).not.toContainText("Checked 25 Oct");
          } else {
            await expect(page.locator('[data-tonight-provenance="undated-whats-on"]')).toHaveCount(0);
          }
          if (scenario === "24-hour boundary") {
            await expect(page.getByRole("heading", { name: "Exactly 24 hours", exact: true })).toBeVisible();
            await expect(page.getByRole("heading", { name: "One millisecond too old", exact: true })).toHaveCount(0);
          }
          if (scenario === "past and unmatched") {
            await expect(page.getByRole("heading", { name: "Finished concert", exact: true })).toHaveCount(0);
            await expect(page.getByRole("heading", { name: "Unmatched concert", exact: true })).toHaveCount(0);
          }
        }
      }
      await expect(page.locator("body")).not.toContainText("Checked 7 Oct");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${scenario.replaceAll(" ", "-")}-${width}.png`), fullPage: true });
    });
  }
}
