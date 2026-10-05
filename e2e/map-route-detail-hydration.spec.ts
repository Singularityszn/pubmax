import { expect, test, type Response } from "@playwright/test";
import { rowsFromSlimPayload } from "../lib/slimPayload";
import { desktopPlannerDrawer, expectSoleDesktopDrawer } from "./helpers/mapSurfaceDrawers";

const DUKE = "venue-149rmv7";
const HATTON = "venue-1vle947";

test.use({ serviceWorkers: "block" });

test("shared Beer route adopts authentic detail after slim rows arrive", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });

  // Delay delivery only. route.fetch obtains the server's real response, and
  // fulfill forwards that response unchanged. No drink metadata is fabricated.
  let releaseDetail!: () => void;
  const detailRelease = new Promise<void>((resolve) => { releaseDetail = resolve; });
  const detailDeliveries: Promise<void>[] = [];
  const slimReads: Promise<void>[] = [];
  const slimIds = new Set<string>();
  let detailStatus: number | null = null;
  let authenticPintLabel: string | null = null;
  let detailReleased = false;
  let slimVenueCount: number | null = null;
  let beforeLabel: string | null = null;
  let afterLabel: string | null = null;

  await page.route((url) => url.pathname === `/api/venue/${DUKE}`, (route) => {
    const delivery = (async () => {
      const response = await route.fetch();
      detailStatus = response.status();
      const payload = await response.json();
      authenticPintLabel = payload.venue?.cheapestPint ?? null;
      await detailRelease;
      await route.fulfill({ response });
    })();
    detailDeliveries.push(delivery);
    return delivery;
  });
  const readArrivalSlim = (response: Response) => {
    const pathname = new URL(response.url()).pathname;
    if (!response.ok() || !/^\/data\/venues_slim(?:\.[^/]+)?\.json$/.test(pathname)
      || pathname.endsWith(".manifest.json")) return;
    const read = (async () => {
      const rows = rowsFromSlimPayload(await response.json());
      expect(rows, `public slim payload ${pathname}`).not.toBeNull();
      for (const row of rows ?? []) {
        if (typeof row === "object" && row !== null && "id" in row && typeof row.id === "string") {
          slimIds.add(row.id);
        }
      }
    })();
    slimReads.push(read);
  };
  page.on("response", readArrivalSlim);
  const routePanel = desktopPlannerDrawer(page).locator(".routePanel");

  try {
    const response = await page.goto(`/map?drink=beer&mode=build&pubs=${DUKE},${HATTON}`);
    expect(response?.status()).toBe(200);
    const toggle = page.getByRole("button", { name: /^(Plan an outing|Close plan)$/ });
    await expect(async () => {
      if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
      await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
    await expectSoleDesktopDrawer(page, "planner");
    await expect(routePanel.locator(".routeList > li")).toHaveCount(2);
    await expect.poll(() => slimIds.has(DUKE)).toBe(true);
    await expect.poll(async () => Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count"))).toBeGreaterThan(2);
    await expect.poll(() => detailStatus).toBe(200);
    await expect.poll(() => authenticPintLabel).toBe("AMSTEL");
    await expect(routePanel.locator(".routeList > li").first()).toContainText("Duke of York");
    await expect(routePanel.locator(".routeList > li").first()).toContainText("£6.15");
    await expect(routePanel.locator(".routeList")).not.toContainText("AMSTEL");
    expect(new URL(page.url()).searchParams.get("sel")).toBeNull();
    beforeLabel = await routePanel.locator(".routeList").innerText();
    slimVenueCount = Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count"));
    page.off("response", readArrivalSlim);
    await Promise.all(slimReads);

    releaseDetail();
    detailReleased = true;
    await Promise.all(detailDeliveries);
    // The existing ten-second expectation must pass without selecting a stop.
    await expect(routePanel.locator(".routeList")).toContainText("AMSTEL");
    await expect(routePanel.locator(".routeList > li")).toHaveCount(2);
    await expect(routePanel.locator(".routeList > li").nth(1)).toContainText("The Sir Christopher Hatton");
    await expect(routePanel.locator(".routeMetrics")).toContainText("£6.15");
    await expect(routePanel.locator(".routeMetrics")).toContainText("known subtotal · 1 of 2 stops priced");
    expect(new URL(page.url()).searchParams.get("sel")).toBeNull();
    await testInfo.attach("route-detail-after", { body: await page.screenshot(), contentType: "image/png" });
  } finally {
    page.off("response", readArrivalSlim);
    releaseDetail();
    const deliveryResults = await Promise.allSettled(detailDeliveries);
    const slimResults = await Promise.allSettled(slimReads);
    afterLabel = await routePanel.locator(".routeList").textContent();
    await testInfo.attach("route-detail-delivery-order", {
      body: JSON.stringify({
        deliveryOrder: "slim route before authentic Duke detail",
        detailStatus, authenticPintLabel, detailReleased, dukeSeenInPublicSlim: slimIds.has(DUKE),
        slimVenueCount, beforeLabel, afterLabel, url: page.url(),
        detailRequestCount: detailDeliveries.length,
        detailDeliveryErrors: deliveryResults.filter((result) => result.status === "rejected").length,
        slimReadErrors: slimResults.filter((result) => result.status === "rejected").length,
      }, null, 2),
      contentType: "application/json",
    });
    expect(deliveryResults.filter((result) => result.status === "rejected")).toEqual([]);
    expect(slimResults.filter((result) => result.status === "rejected")).toEqual([]);
  }
});
