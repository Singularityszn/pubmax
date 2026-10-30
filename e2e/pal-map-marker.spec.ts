import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";

// The Pal on the map (components/map/canvas/palMarker.ts): the reader's own
// Pub Pal perches beside the pub they open, takes no taps from the pins under
// it, and is never made for a Pal the reader hid. On tonight's plan it waits at
// the next stop as the one button it ever is, and a tap opens that pub. Shots land in
// artifacts/pal-map-marker/ (gitignored).

const SHOTS = "artifacts/pal-map-marker";
const VENUE_ID = "venue-xjf3n0";
// Three Soho stops from the "Victorian Soho" curated crawl (alt-crawls.spec.ts).
const CRAWL = "venue-1ufn31x,venue-1t8siin,venue-xiesdn";
const PLAN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function seedPal(page: Page, hidden = false): Promise<void> {
  await page.addInitScript(({ appearance, personality, voice, hidden: palHidden }) => {
    const now = "2026-10-04T12:00:00.000Z";
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner-e2e", name: "Ripley",
      adultAttestedAt: now, appearance, personality, voice, muted: false, hidden: palHidden,
      proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    }));
  }, { ...DEFAULT_PAL_DRAFT, hidden });
}

test.describe("the Pal on the map", () => {
  test("perches beside the open pub and takes no taps", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    await page.goto(`/map?sel=${VENUE_ID}`);

    const marker = page.locator(".palMapMarker");
    await expect(marker).toBeVisible({ timeout: 60_000 });
    await expect(marker).toHaveAttribute("aria-hidden", "true");
    await expect(marker.locator("a, button")).toHaveCount(0);
    expect(await marker.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("none");
    const image = marker.locator("img");
    await expect(image).toHaveAttribute("src", /avatar/);
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await page.waitForTimeout(1_200);
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pal-on-map-390.png` });
  });

  test("waits at tonight's next stop as a button that opens it, and walks on when the night does", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const stops = CRAWL.split(",");
    await page.route(`**/api/plans/${PLAN_ID}`, (route) => route.fulfill({
      json: { stops: stops.map((venueId, position) => ({ venueId, venueName: venueId, position })) },
    }));
    await page.route(`**/api/plans/${PLAN_ID}/pals`, (route) => route.fulfill({ json: { visibility: "member", pals: [] } }));
    await seedPal(page);
    await page.addInitScript((planId) => {
      // Set once, so a reload or a later cursor write in the test is kept.
      if (window.sessionStorage.getItem("e2e-plan-seeded")) return;
      window.sessionStorage.setItem("e2e-plan-seeded", "1");
      window.localStorage.setItem("pubmax_active_plan", JSON.stringify({
        version: 1, id: planId, startTime: new Date(Date.now() - 60 * 60 * 1000).toISOString(), stopIndex: 0,
      }));
    }, PLAN_ID);
    await page.goto("/map");

    // On the first stop, tonight's next stop is the second: the Pal waits there as a button.
    const marker = page.locator(".palMapMarker:not([data-pal-crew])");
    await expect(marker).toHaveAttribute("role", "button", { timeout: 60_000 });
    const label = (await marker.getAttribute("aria-label")) ?? "";
    expect(label).toMatch(/^Next stop: \S/);
    const name = label.replace(/^Next stop: /, "");
    await expect(marker.locator(".palMapMarkerNext")).toHaveText(`Next: ${name}`);
    await expect(marker).not.toHaveAttribute("aria-hidden", "true");
    expect(await marker.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe("auto");
    const box = (await marker.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(38);
    await page.waitForTimeout(900);
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pal-next-stop-390.png` });

    // A tap opens that pub.
    await marker.click();
    await expect(page).toHaveURL(new RegExp(`sel=${stops[1]}`), { timeout: 30_000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/pal-next-stop-opened-390.png` });

    // Night Mode moves on to the second stop: the Pal walks on to the third and waits there.
    await page.evaluate(() => {
      const raw = window.localStorage.getItem("pubmax_active_plan")!;
      window.localStorage.setItem("pubmax_active_plan", JSON.stringify({ ...JSON.parse(raw), stopIndex: 1 }));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(marker).not.toHaveAttribute("aria-label", label, { timeout: 30_000 });
    await expect(marker).toHaveAttribute("aria-label", /^Next stop: \S/, { timeout: 30_000 });
  });

  test("is never made for a Pal the reader hid", async ({ page }) => {
    test.setTimeout(120_000);
    await seedPal(page, true);
    await page.goto(`/map?sel=${VENUE_ID}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(3_000);
    await expect(page.locator(".palMapMarker")).toHaveCount(0);
  });

  test("walks the crawl route once, then rests beside the last stop", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);

    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", "walking", { timeout: 60_000 });
    await expect(marker.locator("a, button")).toHaveCount(0);
    await mkdir(SHOTS, { recursive: true });
    const box = async () => (await marker.boundingBox())!;
    const first = await box();
    await page.screenshot({ path: `${SHOTS}/pal-walking-390.png` });
    await page.waitForTimeout(1_500);
    const later = await box();
    // It moved along the route on its own, with no camera move asked for.
    expect(Math.hypot(later.x - first.x, later.y - first.y)).toBeGreaterThan(4);

    await expect(marker).toHaveAttribute("data-pal-walk", "rested", { timeout: 30_000 });
    await expect(marker).not.toHaveClass(/isWalking/);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/pal-rested-390.png` });
  });

  test("waits at the first stop under reduced motion", async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await seedPal(page);
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);
    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", "waiting", { timeout: 60_000 });
    const first = (await marker.boundingBox())!;
    await page.waitForTimeout(2_000);
    const later = (await marker.boundingBox())!;
    expect(Math.hypot(later.x - first.x, later.y - first.y)).toBeLessThan(1);
  });

  test("walks to a crawl stop the reader taps, and jumps beside it", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    // The road request carries the crawl's stops, in order, as lng,lat pairs.
    const routed = page.waitForRequest(/\/api\/walk-route\?/, { timeout: 60_000 });
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);
    const stops = new URL((await routed).url()).searchParams.get("stops")!
      .split(";").map((pair) => pair.split(",").map(Number) as [number, number]);
    expect(stops).toHaveLength(3);

    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", "rested", { timeout: 60_000 });
    const tap = await page.evaluate((lngLat) => (
      window as Window & { __pubmaxMapCamera?: { project: (point: [number, number]) => { x: number; y: number } } }
    ).__pubmaxMapCamera!.project(lngLat), stops[0]!);
    await page.mouse.click(tap.x, tap.y);

    await expect(marker).toHaveAttribute("data-pal-walk", "visiting");
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/pal-visiting-390.png` });
    await expect(marker).toHaveAttribute("data-pal-walk", "visited", { timeout: 10_000 });
    await expect(marker).toHaveClass(/isCheering/);
    // It perches up and to the right of the stop it was sent to.
    const at = await page.evaluate((lngLat) => (
      window as Window & { __pubmaxMapCamera?: { project: (point: [number, number]) => { x: number; y: number } } }
    ).__pubmaxMapCamera!.project(lngLat), stops[0]!);
    const box = (await marker.boundingBox())!;
    expect(Math.abs(box.x - 14 - at.x)).toBeLessThan(3);
    expect(Math.abs(box.y + box.height + 12 - at.y)).toBeLessThan(3);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/pal-visited-390.png` });
  });

  test("cheers everywhere when the reader finishes the crawl", async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPal(page);
    await page.goto(`/map?mode=build&pubs=${CRAWL}`);
    const marker = page.locator(".palMapMarker");
    await expect(marker).toHaveAttribute("data-pal-walk", /walking|rested/, { timeout: 60_000 });

    // Open the route panel from the plan pill, as a phone reader does.
    const panel = page.locator(".mapDrawer .routePanel");
    const pill = page.getByRole("button", { name: /stop plan/ });
    await expect(async () => {
      if (!(await panel.isVisible())) await pill.first().click();
      await expect(panel).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await panel.getByRole("button", { name: "Start this crawl", exact: true }).click();
    await panel.getByRole("button", { name: "Mark complete", exact: true }).click();

    // The celebration card: the person's Pal jumps with its line.
    const cheer = page.getByTestId("crawl-celebration").getByTestId("pal-cheer");
    await expect(cheer).toHaveText("Ripley walked all 3 stops with you.");
    // The Pal on the map runs to the last stop and celebrates there.
    await expect(marker).toHaveAttribute("data-pal-moment", "victory", { timeout: 10_000 });
    await expect(marker).toHaveClass(/isVictory/);
    // The summon chip says so too, if it is on screen.
    const chip = page.locator(".palSummon");
    if (await chip.isVisible()) await expect(chip).toContainText("Walked all 3 stops");
    await mkdir(SHOTS, { recursive: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/pal-crawl-finished-390.png` });
  });
});

