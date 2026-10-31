import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import type { LegOption } from "../lib/legOptions";
import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// Ways to get there (components/night/NightWaysThere.tsx): in Night Mode, the
// ways from this stop to the next, each with its time, TfL's fare and the
// fastest and the cheapest marked, and a tap draws that way on the map. The
// crawl route itself reads like directions: a thick line on its own edge, with
// each leg's minutes on a bubble. The TfL and street-router answers are fixed
// here (GET /api/leg-options, GET /api/walk-route), so the test reads the
// screens, not the outside world. Shots land in artifacts/night-ways-there/
// (gitignored).

const SHOTS = "artifacts/night-ways-there";
const PLAN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
// Three Soho stops from the "Victorian Soho" curated crawl (alt-crawls.spec.ts).
const STOPS = [
  { venueId: "venue-1ufn31x", venueName: "The Nellie Dean" },
  { venueId: "venue-1t8siin", venueName: "The Crown & Two Chairmen" },
  { venueId: "venue-xiesdn", venueName: "The Dog & Duck" },
];

type LngLat = [number, number];

/** TfL-shaped ways between the leg's own two ends, each bent to one side of the leg like real streets. */
function waysBetween(from: LngLat, to: LngLat): LegOption[] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  // `bend` pushes a point off the leg, sideways, by that share of the leg's length.
  const at = (t: number, bend = 0): LngLat => [from[0] + dx * t - dy * bend, from[1] + dy * t + dx * bend];
  const walk: LegOption = {
    id: "walk", kind: "walk", minutes: 4, farePence: 0, estimate: false, fastest: false, cheapest: true,
    parts: [{ mode: "walking", line: null, minutes: 4, path: [from, at(0.35, 0.15), at(0.7, 0.1), to] }],
  };
  const bus: LegOption = {
    id: "transit-0", kind: "transit", minutes: 3, farePence: 175, estimate: false, fastest: true, cheapest: false,
    parts: [
      { mode: "walking", line: null, minutes: 1, path: [from, at(0.15, -0.25)] },
      { mode: "bus", line: "14", minutes: 2, path: [at(0.15, -0.25), at(0.6, -0.3), to] },
    ],
  };
  const tube: LegOption = {
    id: "transit-1", kind: "transit", minutes: 6, farePence: null, estimate: false, fastest: false, cheapest: false,
    parts: [
      { mode: "walking", line: null, minutes: 2, path: [from, at(0.2, 0.4)] },
      { mode: "tube", line: "Central", minutes: 2, path: [at(0.2, 0.4), at(0.8, 0.4)] },
      { mode: "walking", line: null, minutes: 2, path: [at(0.8, 0.4), to] },
    ],
  };
  return [bus, walk, tube];
}

/** The night's plan, answered by a fixed server: three Soho stops, the reader at the first. */
async function seedTonight(page: Page) {
  const startTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const plan = {
    plan: { id: PLAN_ID, title: "Victorian Soho", startTime, createdAt: startTime, routeRevision: 1, status: "active" },
    stops: STOPS.map((stop, position) => ({ ...stop, position })),
    context: { nightArea: "soho" },
    crew: [],
    actions: [],
  };
  await page.route(`**/api/plans/${PLAN_ID}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/session") ? { active: true, role: "host", collaborationAuthorized: true } : { stops: [] } });
  });
  await page.route(`**/api/plans/${PLAN_ID}`, (route) => route.fulfill({ json: plan }));
  await page.addInitScript((planId) => {
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    if (window.sessionStorage.getItem("e2e-plan-seeded")) return;
    window.sessionStorage.setItem("e2e-plan-seeded", "1");
    window.localStorage.setItem("pubmax_active_plan", JSON.stringify({
      version: 1, id: planId, startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), stopIndex: 0, role: "host",
    }));
  }, PLAN_ID);
}

/** The reader's own Pub Pal, stored the way the Pal flow stores it. */
async function seedPal(page: Page) {
  await page.addInitScript(({ appearance, personality, voice }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: false,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
  }, DEFAULT_PAL_DRAFT);
}

/** Zoom in on the stops the way a reader would, once the map has settled; the camera itself never moves. */
async function leanIn(page: Page) {
  await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(4_000);
  await page.mouse.move(190, 400);
  for (let turn = 0; turn < 3; turn += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2_000);
}

test("Night Mode lists the ways to the next stop, and a tap draws the chosen one on the map with the Pal leading", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedTonight(page);
  await seedPal(page);
  const asked: string[] = [];
  await page.route("**/api/leg-options**", (route) => {
    const url = new URL(route.request().url());
    asked.push(url.href);
    const point = (name: string): LngLat => {
      const [lat, lng] = url.searchParams.get(name)!.split(",").map(Number);
      return [lng!, lat!];
    };
    return route.fulfill({ json: { status: "ok", options: waysBetween(point("from"), point("to")) } });
  });
  await page.goto("/tonight");
  await page.getByRole("button", { name: "Show tonight's plan" }).click({ timeout: 60_000 });

  const ways = page.getByTestId("night-ways-there");
  await expect(ways).toBeVisible({ timeout: 60_000 });
  const toggle = ways.getByRole("button", { name: "Ways to get there" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(asked).toEqual([]);
  await toggle.click();
  const rows = ways.locator(".nightWays__option");
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  expect(asked).toHaveLength(1);
  expect(new URL(asked[0]!).searchParams.get("from")).toMatch(/^51\.\d{5},-0\.\d{5}$/);
  await expect(rows.nth(0)).toContainText("Bus 14");
  await expect(rows.nth(0)).toContainText("Fastest");
  await expect(rows.nth(1)).toContainText("Free");
  await expect(rows.nth(1)).toContainText("Cheapest");
  await expect(rows.nth(2)).toContainText("Fare not listed");
  for (const row of await rows.all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  // The next-stop button keeps its own height above the list: nothing lies on it.
  const nextBox = (await page.locator(".nightCard__next").boundingBox())!;
  const toggleBox = (await toggle.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(toggleBox.y);
  await ways.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/ways-390.png` });

  // A tap draws that way on the map and takes the reader there, and the Pal
  // leads it: one line about the choice (the tube's fare is not listed), the
  // walk along that path, then a wait at the next stop as its button.
  await rows.nth(2).click();
  await expect(page).toHaveURL(/\/map/, { timeout: 30_000 });
  const pal = page.locator(".palMapMarker:not([data-pal-crew])");
  await expect(pal.locator(".palMapMarkerSay")).toHaveText("TfL won't say the fare. Bold choice.", { timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/pal-leads-390.png` });
  await expect(pal).toHaveAttribute("aria-label", "Next stop: The Crown & Two Chairmen", { timeout: 60_000 });
  await expect(pal.locator(".palMapMarkerSay")).toBeHidden();
  await leanIn(page);
  await page.screenshot({ path: `${SHOTS}/way-on-map-390.png` });
});

test("a routed crawl is a thick solid line with its walking minutes on a bubble on each leg, and the Pal sets off saying the first one", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedTonight(page);
  await seedPal(page);
  // The street router's answer, fixed: each leg turns one corner, as a street walk does.
  const routed: string[] = [];
  await page.route("**/api/walk-route**", (route) => {
    routed.push(route.request().url());
    const stops = new URL(route.request().url()).searchParams
      .get("stops")!
      .split(";")
      .map((pair) => pair.split(",").map(Number) as LngLat);
    const legs = stops.slice(1).map((to, index) => {
      const from = stops[index]!;
      return { from, corner: [from[0], to[1]] as LngLat, to };
    });
    return route.fulfill({
      json: {
        line: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: { source: "ors" },
            geometry: { type: "LineString", coordinates: legs.flatMap(({ from, corner, to }) => [from, corner, to]) },
          }],
        },
        source: "ors",
        // Each leg's middle is halfway down its first, longer run.
        legs: legs.map(({ from, to }, index) => ({
          fromIndex: index,
          toIndex: index + 1,
          distanceKm: 0.5 + index * 0.25,
          source: "ors",
          midpoint: [from[0], (from[1] + to[1]) / 2],
        })),
      },
    });
  });
  await page.goto("/map");
  // The Pal speaks as it sets off, with the first leg's own time (lib/palMapLines.ts).
  const said = page.locator(".palMapMarker:not([data-pal-crew]) .palMapMarkerSay");
  await expect(said).toHaveText(
    /^(About )?\d+ min (to the next pub\. Race you\.|on foot\. I'll wait at the door\.|to the next one\. Stretch first\.)$/,
    { timeout: 60_000 },
  );
  await page.screenshot({ path: `${SHOTS}/pal-sets-off-390.png` });
  await expect.poll(() => routed.length, { timeout: 60_000 }).toBeGreaterThan(0);
  await leanIn(page);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/routed-crawl-390.png` });
});

// The Pal leads a chosen way, then the plan ends with the map still open: the
// Pal keeps the map's own answer (a perch beside the open pub, or no Pal),
// and never walks the ended plan again.
for (const opened of [true, false]) {
  test(`after the Pal led the way, a plan that ends leaves ${opened ? "it perched beside the open pub" : "no Pal on the map"}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedTonight(page);
    await seedPal(page);
    await page.route("**/api/leg-options**", (route) => {
      const url = new URL(route.request().url());
      const point = (name: string): LngLat => {
        const [lat, lng] = url.searchParams.get(name)!.split(",").map(Number);
        return [lng!, lat!];
      };
      return route.fulfill({ json: { status: "ok", options: waysBetween(point("from"), point("to")) } });
    });
    await page.goto("/tonight");
    await page.getByRole("button", { name: "Show tonight's plan" }).click({ timeout: 60_000 });
    const ways = page.getByTestId("night-ways-there");
    await ways.getByRole("button", { name: "Ways to get there" }).click({ timeout: 60_000 });
    await ways.locator(".nightWays__option").nth(1).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/map/, { timeout: 30_000 });
    const pal = page.locator(".palMapMarker:not([data-pal-crew])");
    await expect(pal).toHaveAttribute("aria-label", "Next stop: The Crown & Two Chairmen", { timeout: 60_000 });
    if (opened) {
      // The reader taps the waiting Pal: the next stop opens.
      await pal.click();
      await expect(page).toHaveURL(/sel=venue-1t8siin/, { timeout: 30_000 });
    }

    // The plan ends in this tab. Every walk state the Pal takes from then on is
    // recorded, so even a moment's replay of the ended plan's walk is caught.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { palWalkSeen: string[] }).palWalkSeen = seen;
      new MutationObserver((records) => {
        for (const record of records) {
          const target = record.target as HTMLElement;
          if (target.classList?.contains("palMapMarker") && !target.dataset.palCrew) seen.push(target.dataset.palWalk ?? "");
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-pal-walk"] });
      window.localStorage.removeItem("pubmax_active_plan");
      window.dispatchEvent(new Event("pubmax:active-plan"));
    });
    const replayed = () => page.evaluate(() => (window as unknown as { palWalkSeen: string[] }).palWalkSeen.filter((state) => state !== ""));
    if (opened) {
      await expect(pal).toBeVisible();
      await expect(pal).not.toHaveAttribute("data-pal-walk", /.+/, { timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(pal).not.toHaveAttribute("data-pal-walk", /.+/);
      await expect(pal).not.toHaveClass(/isWalking/);
      await expect(pal).not.toHaveAttribute("role", "button");
    } else {
      await expect(pal).toHaveCount(0, { timeout: 30_000 });
      await page.waitForTimeout(3_000);
      await expect(pal).toHaveCount(0);
    }
    expect(await replayed()).toEqual([]);
  });
}
