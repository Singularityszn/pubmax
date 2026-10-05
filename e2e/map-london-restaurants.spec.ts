import { expect, test, type Page } from "@playwright/test";

// London restaurants that serve alcohol, asserted in a real browser with a real
// MapLibre canvas (this spec runs in the `chromium-gl` project):
//
//   1. DRAWN. A normal London entry reads the one restaurant pack, never the
//      London venue shards, and paints restaurant pins.
//   2. OPENED. Tapping a painted restaurant opens its sheet by its own
//      `venue-osm-` id, with no price on it.
//   3. SHARED. A cold `?sel=venue-osm-…` link opens the same sheet.
//
// `data-london-restaurant-count` on .mapCanvasWrap is how many restaurants the
// map hands the layer; the London-place tap probe
// (components/map/canvas/paintedPinProbe.ts) names the ones MapLibre placed.

const VIEWPORT = { width: 390, height: 844 };
const PACK_PATH = "/data/london_restaurants/restaurants.json";

type PaintedMark = { kind: "pin" | "cluster"; id: string; x: number; y: number };

async function paintedRestaurants(page: Page): Promise<PaintedMark[]> {
  const marks = await page.evaluate(
    () =>
      (
        window as Window & {
          __pubmaxPaintedLondonPlaceTapPoints?: () => PaintedMark[];
        }
      ).__pubmaxPaintedLondonPlaceTapPoints?.() ?? [],
  );
  return marks.filter((mark) => mark.kind === "pin" && mark.id.startsWith("venue-osm-"));
}

function londonDataReads(page: Page): string[] {
  const paths: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/data/london_restaurants/") || path.startsWith("/data/london_venues/")) {
      paths.push(path);
    }
  });
  return paths;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
  });
});

test("a London entry draws restaurants from one pack, and a tap opens one", async ({ page }) => {
  test.setTimeout(180_000);
  const reads = londonDataReads(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => Number(await wrap.getAttribute("data-london-restaurant-count")), {
      timeout: 60_000,
    })
    .toBeGreaterThan(500);

  // One read of the pack, and not one London venue shard.
  expect(reads.filter((path) => path === PACK_PATH)).toHaveLength(1);
  expect(reads.filter((path) => path.startsWith("/data/london_venues/"))).toEqual([]);

  const sheet = page.locator(".londonRestaurant");
  let attempt = 0;
  await expect
    .poll(
      async () => {
        // A sheet that opened after the last check covers the map, so read it
        // before looking for another restaurant to tap.
        if ((await sheet.count()) > 0) return new URL(page.url()).searchParams.get("sel");
        const restaurants = await paintedRestaurants(page);
        if (restaurants.length === 0) return null;
        const mark = restaurants[attempt % restaurants.length];
        attempt += 1;
        await page.mouse.click(mark.x, mark.y);
        await page.waitForTimeout(400);
        if ((await sheet.count()) === 0) return null;
        return new URL(page.url()).searchParams.get("sel");
      },
      { message: "a painted restaurant opens its own sheet", timeout: 90_000 },
    )
    .toMatch(/^venue-osm-/);

  await expect(sheet).toContainText("Restaurant");
  await expect(sheet).toContainText("A restaurant that serves alcohol.");
  await expect(sheet).not.toContainText("£");
  await expect(
    sheet.getByRole("link", { name: "OpenStreetMap contributors" }),
  ).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
});

test("a shared restaurant link opens its sheet on a cold load", async ({ page }) => {
  test.setTimeout(180_000);
  // 26 Furnival Street: in the pack because its own website states alcohol.
  const response = await page.goto("/map?sel=venue-osm-n25496840");
  expect(response?.status()).toBe(200);

  const sheet = page.locator("[data-london-restaurant='venue-osm-n25496840']");
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".mobileSharedSheetHeader h2")).toHaveText("26 Furnival Street");
  await expect(sheet).toContainText("26, Furnival Street, London, EC4A 1JS");
  expect(new URL(page.url()).searchParams.get("sel")).toBe("venue-osm-n25496840");
});

test("List view gives a keyboard reader every restaurant in view", async ({ page }) => {
  test.setTimeout(180_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const wrap = page.locator(".mapCanvasWrap");
  await expect
    .poll(async () => Number(await wrap.getAttribute("data-london-restaurant-count")), {
      timeout: 60_000,
    })
    .toBeGreaterThan(500);

  const more = page.getByRole("button", { name: "More map controls" });
  await expect(more).toBeVisible({ timeout: 20_000 });
  await more.click();
  const layersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible');
  await expect(layersSheet).toBeVisible({ timeout: 10_000 });
  await layersSheet.getByRole("tab", { name: "Layers" }).click();
  const listShortcut = layersSheet.getByRole("button", { name: "List view of venues on the map" });
  await expect(listShortcut).toBeVisible({ timeout: 10_000 });
  await listShortcut.click();
  await expect(page.locator(".mapVenueListPanel")).toBeVisible({ timeout: 10_000 });

  const group = page.getByRole("list", { name: "Restaurants with no listed price" });
  await expect(group).toBeVisible({ timeout: 30_000 });
  const row = group.locator('button[data-venue-id^="venue-osm-"]').first();
  const id = await row.getAttribute("data-venue-id");
  await row.focus();
  await page.keyboard.press("Enter");

  await expect(page.locator(`[data-london-restaurant='${id}']`)).toBeVisible({ timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("sel")).toBe(id);
});
