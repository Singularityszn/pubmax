import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

// The canonical Tonight grouping, split out of tonight-trusted-ui.spec.ts. It
// used to need PUBMAX_TONIGHT_GROUPING=1 and its own Playwright project; that
// flag is retired and the canonical model is the only model, so this runs in
// the default suite over the shipped server.

const SHOTS_DIR = path.join(process.cwd(), "e2e-shots", "tonight-trusted-ui");

// Deterministic spine: a two-venue deal family (collapses to one card), plus a
// music and a quiz row — enough to show grouping, the secondary lanes, and an
// acceptable Venue, without depending on live upstream data.
// The venue ids are REAL ids out of public/data/venues_slim.json, not readable
// stand-ins: the Keep control renders only for a venue the map can open
// (tonightAcceptedVenueId over loadMapSelectableVenueIds), so a made-up id
// silently removes the very control these tests are about. The place names
// stay invented, because they come from the mocked row alone.
const TEST_TONIGHT_START = Date.now() + 60 * 60 * 1000;
const ROWS = [
  { id: "d1", venueId: "venue-xjf3n0", placeName: "The Deal Arms A", kind: "deal", startsAt: new Date(TEST_TONIGHT_START).toISOString(), title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "d2", venueId: "venue-1f5ygjb", placeName: "The Deal Arms B", kind: "deal", startsAt: new Date(TEST_TONIGHT_START).toISOString(), title: "Curry Club", source: { label: "Chain Co", url: "https://chain.example/deal" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "m1", venueId: "venue-3h52h", placeName: "The Blue Note", kind: "music", startsAt: new Date(TEST_TONIGHT_START + 60 * 60 * 1000).toISOString(), title: "Live Jazz", source: { label: "Listings", url: "https://listings.example/jazz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
  { id: "q1", venueId: "venue-lrz4u2", placeName: "The Sharp Wit", kind: "quiz", startsAt: new Date(TEST_TONIGHT_START - 30 * 60 * 1000).toISOString(), title: "Pub Quiz", source: { label: "Listings", url: "https://listings.example/quiz" }, observedAt: "2026-07-20T12:00:00.000Z", confidence: "listed" },
];

type WhatsOnBody = {
  rows?: typeof ROWS;
  sourceFreshnessKind?: string;
  sourceObservedAt?: string | null;
};

async function mockWhatsOn(page: Page, body: WhatsOnBody = {}) {
  await page.route("**/api/out?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [],
      }),
    }),
  );
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: body.rows ?? ROWS,
        servedAt: new Date().toISOString(),
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

test.describe("Tonight trusted UI (canonical grouping)", () => {
  test("keeps secondary lanes directly after the main list on phones", async ({ page }) => {
    await mockWhatsOn(page, { rows: [ROWS[0]!, ROWS[2]!] });
    await openTonight(page);
    const order = await page.evaluate(() => {
      const selectors = [
        '[data-testid="tonight-list"]',
        'section[aria-labelledby="deals-tonight-title"]',
        'section[aria-labelledby="music-tonight-title"]',
        ".tonightQuiet",
        ".tonightLocation",
      ];
      const elements = selectors.map((selector) => document.querySelector(selector));
      if (elements.some((element) => element === null)) return [];
      return elements.slice(1).map((element, index) => Boolean(
        elements[index]!.compareDocumentPosition(element!)
          & Node.DOCUMENT_POSITION_FOLLOWING,
      ));
    });
    expect(order).toEqual([true, true, true, true]);
    await shoot(page, "grouping");
  });

  test("accepting a Tonight Venue arrives at the map as src=tonight", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    const accept = page.getByRole("button", { name: /Keep .+ for tonight/i }).first();
    await expect(accept).toBeVisible();
    await accept.click();
    await page.waitForURL(/\/map\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("accept")).toBe("1");
    expect(url.searchParams.get("src")).toBe("tonight");
    expect(url.searchParams.get("sel")).toMatch(/^venue-/);
  });

  test("a grouped alternate keeps Tonight provenance", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    await page.locator("summary", { hasText: "Same deal at 2 pubs" }).click();
    const keepAlternate = page.getByRole("button", {
      name: "Keep The Deal Arms B for tonight",
    });
    await expect(keepAlternate).toBeVisible();
    await keepAlternate.click();
    await expect(page).toHaveURL(/\/map\?[^#]*sel=venue-1f5ygjb[^#]*&accept=1&src=tonight/);
  });
});
