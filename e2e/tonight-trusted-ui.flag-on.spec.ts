import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// DAG L15 flag-ON half, split out of tonight-trusted-ui.spec.ts so neither half
// needs a runtime test.skip (L20 zero-skip contract). This file runs ONLY in the
// flag-on invocation: the chromium-flag-on project drives a server built with
// PUBMAX_TONIGHT_GROUPING=1 and PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE=1 (see the
// flag-on run's documented env set + playwright.config webServer pass-through),
// so every assertion below always executes.

const SHOTS_DIR = path.join(process.cwd(), "e2e-shots", "tonight-trusted-ui");

// Deterministic spine: a two-venue deal family (collapses to one card), plus a
// music and a quiz row — enough to show grouping, the secondary lanes, and an
// acceptable Venue, without depending on live upstream data.
const ROWS = [
  { id: "d1", venueId: "venue-deala", placeName: "The Deal Arms A", kind: "deal", startsAt: "2026-07-24T20:00:00.000Z", title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "d2", venueId: "venue-dealb", placeName: "The Deal Arms B", kind: "deal", startsAt: "2026-07-24T20:00:00.000Z", title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "m1", venueId: "venue-music", placeName: "The Blue Note", kind: "music", startsAt: "2026-07-24T21:00:00.000Z", title: "Live Jazz", source: { label: "Listings", url: "https://listings.example/jazz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "q1", venueId: "venue-quiz", placeName: "The Sharp Wit", kind: "quiz", startsAt: "2026-07-24T19:30:00.000Z", title: "Pub Quiz", source: { label: "Listings", url: "https://listings.example/quiz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
];

type WhatsOnBody = { sourceFreshnessKind?: string; sourceObservedAt?: string | null };

async function mockWhatsOn(page: Page, body: WhatsOnBody = {}) {
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: ROWS,
        servedAt: "2026-07-24T22:00:00.000Z",
        sourceObservedAt: body.sourceObservedAt ?? "2026-07-20T12:00:00.000Z",
        sourceFreshnessKind: body.sourceFreshnessKind ?? "provider-observed",
        localityBasis: "london-default",
        asOf: body.sourceObservedAt ?? "2026-07-20T12:00:00.000Z",
      }),
    }),
  );
}

async function openTonight(page: Page, viewport = { width: 390, height: 844 }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => window.localStorage.setItem("pubmax-tour-v1-done", "1"));
  const response = await page.goto("/tonight");
  expect(response?.status()).toBe(200);
  await expect(page.getByTestId("tonight-list")).toBeVisible();
}

async function shoot(page: Page, name: string) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    // The app's dark theme is driven by html[data-theme="dark"], NOT the OS media
    // query, so set the attribute directly — emulateMedia alone leaves it light.
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((s) => document.documentElement.setAttribute("data-theme", s), scheme);
    for (const width of [390, 1440] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}-${width}-${scheme}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.emulateMedia({ colorScheme: "light" });
}

test.describe("Tonight trusted UI (flag on / canonical)", () => {
  test("moves Deals/Music below the main list (main-list-first §4.11)", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    const order = await page.evaluate(() => {
      const l = document.querySelector('[data-testid="tonight-list"]');
      const d = document.querySelector(".dealsTonight");
      return l && d ? l.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy(); // deals FOLLOWS list → deals below
    await shoot(page, "flagon");
  });

  test("accepting a Tonight Venue arrives at the map as src=tonight", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    const accept = page.getByRole("button", { name: /Use this venue/i }).first();
    await expect(accept).toBeVisible();
    await accept.click();
    await page.waitForURL(/\/map\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("accept")).toBe("1");
    expect(url.searchParams.get("src")).toBe("tonight");
    expect(url.searchParams.get("sel")).toMatch(/^venue-/);
  });
});
