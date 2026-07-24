import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";

// DAG L15 — Tonight trusted UI + acceptance under PUBMAX_TONIGHT_GROUPING.
// The default webServer leaves the flag OFF (shipped). Flag-on cases require
// PUBMAX_TONIGHT_GROUPING=1 (and, for acceptance, PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE=1)
// on the Playwright webServer (see playwright.config env pass-through).

const FLAG_ON = process.env.PUBMAX_TONIGHT_GROUPING === "1";
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

function trackWhatsOn(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req: Request) => {
    if (req.url().includes("/api/whats-on")) urls.push(req.url());
  });
  return urls;
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

test.describe("Tonight trusted UI (flag off / shipped)", () => {
  test.skip(FLAG_ON, "this suite asserts the flag-off shipped behaviour");

  test("keeps Deals/Music above the main list (shipped position)", async ({ page }) => {
    await mockWhatsOn(page);
    await openTonight(page);
    // Shipped order: the deals lane precedes the main list in the DOM.
    const deals = page.locator(".dealsTonight").first();
    await expect(deals).toBeVisible();
    const order = await page.evaluate(() => {
      const d = document.querySelector(".dealsTonight");
      const l = document.querySelector('[data-testid="tonight-list"]');
      return d && l ? d.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING : 0;
    });
    expect(order).toBeTruthy(); // list FOLLOWS deals → deals above
    await shoot(page, "flagoff");
  });

  test("loads the spine once — secondary lanes reuse, never self-fetch", async ({ page }) => {
    const urls = trackWhatsOn(page);
    await mockWhatsOn(page);
    await openTonight(page);
    await expect(page.getByTestId("tonight-list")).toBeVisible();
    await page.waitForTimeout(500);
    // The main list fetches window=tonight; the lanes must NOT self-fetch by kind.
    expect(urls.filter((u) => /kind=deal|kind=music/.test(u))).toHaveLength(0);
    expect(urls.filter((u) => u.includes("window=tonight")).length).toBe(1);
  });

  test("renders honest unknown freshness, never request time", async ({ page }) => {
    await mockWhatsOn(page, { sourceFreshnessKind: "unknown", sourceObservedAt: null });
    await openTonight(page);
    await expect(page.getByText(/Freshness unknown · via what’s-on/i)).toBeVisible();
    await expect(page.getByText(/Checked 24 Jul/i)).toHaveCount(0);
  });
});

test.describe("Tonight trusted UI (flag on / canonical)", () => {
  test.skip(!FLAG_ON, "run with PUBMAX_TONIGHT_GROUPING=1 (and INTENT_WRITE=1 for acceptance)");

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
    test.skip(
      process.env.PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE !== "1",
      "acceptance requires PUBMAX_TRUSTED_HANDOFF_INTENT_WRITE=1",
    );
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

test.describe("Discover secondary lanes still self-fetch", () => {
  test("the deals lane fetches its own spine on /discover (no host to reuse)", async ({ page }) => {
    const urls = trackWhatsOn(page);
    await mockWhatsOn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => window.localStorage.setItem("pubmax-tour-v1-done", "1"));
    const response = await page.goto("/discover");
    expect(response?.status()).toBe(200);
    await page.waitForTimeout(800);
    // On Discover the lanes have no host rows, so they self-fetch by kind.
    expect(urls.some((u) => u.includes("kind=deal"))).toBe(true);
  });
});
