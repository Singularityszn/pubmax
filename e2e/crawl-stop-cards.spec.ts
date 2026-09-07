import { test, expect, type Locator, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// Network failure fixtures must own the reads, including worker fetches.
test.use({ serviceWorkers: "block" });

// D7 — a crawl stop card has to answer two questions on its own: which pub is
// this, and how long is the walk to it.
//
// Production answered neither. A Camden route printed two cards both reading
// "The Queens Head" over "Camden", with nothing else to separate them. And each
// card carried its own straight-line walk line PLUS a TfL journey line that was
// walk-only, so one leg read as two different walk times.
//
// The two seeded pubs below are the same pair: both "The Queens Head", both
// Camden, one on Acton St and one on Theobalds Rd. WebGL is never touched — the
// route is seeded through the URL, exactly as a shared crawl link does.

const QUEENS_HEAD_ACTON_ST = "venue-1u82rds";
const QUEENS_HEAD_THEOBALDS_RD = "venue-b85at0";
const FRIEND_AT_HAND = "venue-yl1a48";
// Three stops, so a middle card carries both a leg of its own and a journey.
// With two stops the off-by-one hid itself: the only leg sat on card 1 while the
// only journey was keyed to card 2, which has no leg block to print it in.
const SEEDED_PUBS = [QUEENS_HEAD_ACTON_ST, QUEENS_HEAD_THEOBALDS_RD, FRIEND_AT_HAND].join(",");
const SEEDED_STOP_COUNT = 3;

async function mockJourney(page: Page, modes: string[], minutes: number): Promise<void> {
  await page.route("**/api/citymcp/journey**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        journeys: [
          {
            durationMinutes: minutes,
            legs: modes.map((mode) => ({ mode, durationMinutes: minutes })),
          },
        ],
      }),
    }),
  );
}

async function openSeededCrawl(
  page: Page,
  waitForStops = true,
  viewport = { width: 1440, height: 900 },
) {
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.setViewportSize(viewport);
  // plan=1 opens the planner on arrival (lib/mapArrival), so the stop cards
  // mount without a click on the canvas.
  const response = await page.goto(`/map?mode=build&plan=1&pubs=${SEEDED_PUBS}`);
  expect(response?.status()).toBe(200);

  const routePanel = page.locator(".routePanel");
  await expect(routePanel).toBeVisible({ timeout: 45_000 });
  const stops = routePanel.locator("ol.routeList > li");
  if (waitForStops) await expect(stops).toHaveCount(SEEDED_STOP_COUNT, { timeout: 20_000 });
  return { routePanel, stops };
}

async function expectInFirstPlannerViewport(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 });
  await expect.poll(() => target.evaluate((element) => {
    const planner = element.closest<HTMLElement>(".mobileSharedSheetBody, .mapDrawer.left");
    if (!planner) return null;
    const bounds = element.getBoundingClientRect();
    const clip = planner.getBoundingClientRect();
    const button = element.matches("button") ? element : element.querySelector("button") ?? element;
    const control = button.getBoundingClientRect();
    const hit = document.elementFromPoint(control.left + control.width / 2, control.top + control.height / 2);
    return {
      inside: bounds.top >= Math.max(0, clip.top) &&
        bounds.bottom <= Math.min(innerHeight, clip.bottom) &&
        bounds.left >= Math.max(0, clip.left) &&
        bounds.right <= Math.min(innerWidth, clip.right),
      unscrolled: planner.scrollTop === 0 && window.scrollY === 0,
      reachable: hit !== null && button.contains(hit),
    };
  })).toEqual({ inside: true, unscrolled: true, reachable: true });
}

test.describe("crawl stop cards (D7)", () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`existing stops lead the first planner viewport at ${viewport.width}px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      await mockJourney(page, ["walking"], 5);
      const { routePanel, stops } = await openSeededCrawl(page, true, viewport);
      await expect(routePanel).toHaveCount(1);
      await expectInFirstPlannerViewport(stops.first());
      const discovery = page.locator(viewport.width >= 1024 ? ".controlRail" : "#mobile-plan-intent-title");
      await expect(discovery).toHaveCount(1);
      const followsStops = await discovery.evaluate((element) => {
        const stop = document.querySelector(".routeList > li");
        return stop !== null && Boolean(stop.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(followsStops, "discovery follows the existing crawl in keyboard order").toBe(true);
      await page.screenshot({ path: testInfo.outputPath("first-planner-viewport.png") });
    });
  }

  test("keeps loaded stops while a failed stop can be retried", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let requests = 0;
    let recovered = false;
    // Keep the background map cells unavailable so they cannot answer the
    // held stop's detail read before its explicit retry.
    await page.route(/\/data\/venues_slim(?:\.cell\.|\.json(?:\?|$))/, (request) => request.abort("failed"));
    await page.route(`**/api/venue/${QUEENS_HEAD_ACTON_ST}`, async (request) => {
      requests += 1;
      if (recovered) return request.continue();
      await held;
      await request.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await mockJourney(page, ["walking"], 5);
    const { routePanel, stops } = await openSeededCrawl(page, false, { width: 1280, height: 720 });
    const status = routePanel.getByTestId("crawl-stop-load-status");
    try {
      await expect.poll(() => requests).toBe(1);
      await expect(stops).toHaveCount(2, { timeout: 20_000 });
      await expect(status).toContainText("Loading 1 crawl stop");
      await expect(routePanel.getByText("No stops yet.", { exact: false })).toHaveCount(0);
      await expect(routePanel.getByTestId("add-to-calendar")).toHaveCount(0);
      await expect(routePanel.getByTestId("plan-round-bridge")).toHaveCount(0);
      await expect(routePanel.locator(".routeLeg")).toHaveCount(0);
      await expectInFirstPlannerViewport(status);
      await expectInFirstPlannerViewport(stops.first());
      await page.screenshot({ path: testInfo.outputPath("held-stop.png") });
      release();
      await expect(stops).toHaveCount(2);
      await expect(status).toContainText("1 crawl stop could not load");
      await expect(routePanel.getByTestId("add-to-calendar")).toHaveCount(0);
      await expect(routePanel.getByTestId("plan-round-bridge")).toHaveCount(0);
      await expectInFirstPlannerViewport(status);
      await expectInFirstPlannerViewport(stops.first());
      await page.screenshot({ path: testInfo.outputPath("failed-stop.png") });
      recovered = true;
      await routePanel.getByRole("button", { name: "Retry", exact: true }).click();
      await expect(stops).toHaveCount(SEEDED_STOP_COUNT);
      await expect(status).toHaveCount(0);
      await expect(routePanel.getByTestId("add-to-calendar")).toHaveCount(1);
      await expect(stops.locator("strong").first()).toContainText("The Queens Head");
      await expectInFirstPlannerViewport(stops.first());
      await page.screenshot({ path: testInfo.outputPath("recovered-stops.png") });
      expect(requests).toBe(2);
    } finally { release(); }
  });

  test("two stops sharing a name read as different places", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking"], 5);
    const { stops } = await openSeededCrawl(page);

    // The name's own text node — the heading also carries a Pint Drop count chip.
    const names = await stops
      .locator("strong")
      .evaluateAll((nodes) => nodes.map((node) => (node.childNodes[0]?.textContent ?? "").trim()));
    expect(names[0]).toBe(names[1]);
    expect(names[0]).toBe("The Queens Head");

    const places = (await stops.locator("small").allInnerTexts()).map((text) => text.trim());
    expect(places).toHaveLength(SEEDED_STOP_COUNT);
    expect(places[0]).not.toBe(places[1]);
    // The area alone cannot separate them, so the street joins it — cased like
    // the place name it is, not like the search key it was recovered from.
    for (const place of places.slice(0, 2)) {
      expect(place).toContain("Camden");
      expect(place).toMatch(/^[A-Z]/);
    }
  });

  test("a walk-only journey never prints a second walk time", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking"], 5);
    const { routePanel } = await openSeededCrawl(page);

    // A route of N stops carries N-1 legs (lib/routeLegs.buildRouteLegs).
    const legs = routePanel.locator(".routeLeg");
    await expect(legs).toHaveCount(SEEDED_STOP_COUNT - 1);
    await expect(routePanel.locator(".routeLegTransit")).toHaveCount(0);

    // Every card states one time, and states it once.
    for (const text of await legs.allInnerTexts()) {
      expect(text).toMatch(/\d+\s*min\s*walk/);
      expect(text.match(/\d+\s*min/g) ?? []).toHaveLength(1);
    }
  });

  test("a journey that uses transit still earns its own line", async ({ page }) => {
    test.setTimeout(120_000);
    await mockJourney(page, ["walking", "bus", "walking"], 16);
    const { routePanel } = await openSeededCrawl(page);

    // One per leg, each on the card whose own leg it measures.
    const transit = routePanel.locator(".routeLegTransit");
    await expect(transit).toHaveCount(SEEDED_STOP_COUNT - 1);
    await expect(transit.first()).toContainText("bus");
  });
});
