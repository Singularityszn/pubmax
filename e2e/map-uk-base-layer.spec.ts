import { expect, test, type Page } from "@playwright/test";
import { attachBill } from "./helpers/priceBill";

// The UK base layer's two load-bearing promises, asserted in a real browser
// with a real MapLibre canvas (this spec runs in the `chromium-gl` project):
//
//   1. ARRIVAL. London's intentional street-level camera crosses
//      UK_BASE_MIN_ZOOM, so the base layer loads on normal Map entry. A camera
//      below the gate remains fetch-free until it crosses back.
//   2. THE FLYWHEEL. Crossing the gate paints base pubs, and tapping one opens
//      the unverified sheet with the price-submission card on it - an unpriced
//      pub is where the first price is worth the most.
//
// `data-uk-base-count` and `data-uk-base-status` on .mapCanvasWrap are how the
// layer is observable from outside MapLibre; without both, a valid empty view,
// a failed read and a below-gate camera are the same screenshot.

const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: "pubmaxx-e2e-access-token",
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "price-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId: E2E_AUTH_USER_ID,
  });
}

type PaintedMark = {
  kind: "pin" | "cluster";
  id: string;
  x: number;
  y: number;
  lng: number;
  lat: number;
};

async function paintedMarks(page: Page): Promise<PaintedMark[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __pubmaxPaintedMapTapPoints?: () => PaintedMark[];
        }
      ).__pubmaxPaintedMapTapPoints?.() ?? [],
  );
}

function ukBaseRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/data/uk_base/")) urls.push(path);
  });
  return urls;
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

test("normal London entry paints UK base pubs and takes a price", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await seedSignedInSession(page);
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "price-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: "night_owl" }),
    });
  });
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ prices: [], signals: [] }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        price: {
          id: "price-e2e-uk-base",
          venueId: "venue-uk-e2e",
          drinkCategory: "whisky",
          priceGbp: 4.2,
          submittedAt: new Date().toISOString(),
          source: "community",
          corroborations: 1,
        },
        attribution: { status: "credited", handle: "night_owl" },
      }),
    });
  });
  const requests = ukBaseRequests(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toBeVisible({ timeout: 20_000 });
  await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", {
    timeout: 30_000,
  });
  await expect
    .poll(async () => Number(await wrap.getAttribute("data-uk-base-count")), { timeout: 30_000 })
    .toBeGreaterThan(0);
  const curatedBefore = await wrap.getAttribute("data-venue-count");

  // The manifest is fetched once, and only cells the arrival viewport covers follow it.
  expect(requests.filter((url) => url.endsWith("manifest.json"))).toHaveLength(1);
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.length).toBeLessThanOrEqual(8);

  // (2) A base pin opens the unverified sheet, and moving the selection STRAIGHT
  // from one base pub to another hands the second one a clean form. A price
  // typed for pub A that survives into pub B's form is a wrong price one tap
  // from being submitted, so the transition is driven here through a single
  // mounted sheet - pub A, type, tap pub B, with no close in between - rather
  // than asserted on a React key that would pass either way.
  //
  // Pin positions are data-dependent; paintedMapTapPoints names each UK base
  // mark the map is drawing (components/map/canvas/paintedPinProbe.ts).
  const sheet = page.locator(".unverifiedPub");
  const priceField = sheet.locator("input.vpsubInput");
  const TYPED_PRICE = "9.90";
  let firstName: string | null = null;
  let switched = false;

  async function sheetName(): Promise<string> {
    return (
      (await page.locator(".mobileSharedSheetHeader h2").textContent()) ??
      (await sheet.locator(".unverifiedPubName").textContent()) ??
      ""
    ).trim();
  }

  const uniqueUkPins = (marks: PaintedMark[]) => {
    const byId = new Map<string, PaintedMark>();
    for (const mark of marks) {
      if (mark.kind !== "pin" || !mark.id.startsWith("venue-uk-")) continue;
      byId.set(mark.id, mark);
    }
    return [...byId.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  };

  await expect
    .poll(async () => uniqueUkPins(await paintedMarks(page)).length, {
      timeout: 60_000,
    })
    .toBeGreaterThan(1);

  const pins = uniqueUkPins(await paintedMarks(page));
  expect(pins.length).toBeGreaterThan(1);
  let firstPinId: string | null = null;

  async function dismissCuratedSheetIfOpen(): Promise<void> {
    const curatedClose = page.getByRole("button", { name: "Close pub detail" });
    if (!(await curatedClose.isVisible().catch(() => false))) return;
    await curatedClose.click();
    await expect(page.locator(".venueInspector")).toHaveCount(0, { timeout: 10_000 });
    await expect(sheet).toHaveCount(0, { timeout: 5_000 });
  }

  let firstPinAttempt = 0;
  await expect
    .poll(
      async () => {
        await dismissCuratedSheetIfOpen();
        const ukPins = uniqueUkPins(await paintedMarks(page));
        if (ukPins.length === 0) return null;
        const pin = ukPins[firstPinAttempt % ukPins.length];
        firstPinAttempt += 1;
        await page.mouse.click(pin.x, pin.y);
        // The base pub sheet opens at peek and keeps the map live, so a retry
        // that taps the next pin before this one's sheet lands only switches
        // pubs again. Give the tapped pub its own time to open.
        await sheet.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
        if ((await sheet.count()) === 0) return null;
        const name = await sheetName();
        if (!name) return null;
        const sel = new URL(page.url()).searchParams.get("sel");
        if (!sel?.startsWith("venue-uk-")) return null;
        firstPinId = pin.id;
        firstName = name;
        await priceField.fill(TYPED_PRICE);
        await expect(priceField).toHaveValue(TYPED_PRICE);
        return name;
      },
      {
        message: "a painted UK base pin opens the unverified price sheet",
        timeout: 90_000,
      },
    )
    .not.toBeNull();

  expect(firstPinId).not.toBeNull();

  async function selectOtherUkBaseFromList(): Promise<void> {
    const listButton = page
      .locator(
        `button.mapVenueListItem[data-venue-id^="venue-uk-"]:not([data-venue-id="${firstPinId}"])`,
      )
      .first();
    if (!(await listButton.isVisible().catch(() => false))) {
      // On a phone the list sits behind the Layers tab of the Map controls
      // sheet, which opens on its Key tab. A sheet left open on the Key tab
      // covers the map, so every later painted-pin read comes back empty.
      const more = page.getByRole("button", { name: "More map controls" });
      await expect(more).toBeVisible({ timeout: 10_000 });
      await more.click();
      const layersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible');
      await expect(layersSheet).toBeVisible({ timeout: 10_000 });
      await layersSheet.getByRole("tab", { name: "Layers" }).click();
      const listShortcut = layersSheet.getByRole("button", {
        name: "List view of venues on the map",
      });
      await expect(listShortcut).toBeVisible({ timeout: 10_000 });
      await listShortcut.click();
      await expect(page.locator(".mapVenueListPanel")).toBeVisible({ timeout: 10_000 });
      await expect(listButton).toBeVisible({ timeout: 15_000 });
    }
    await listButton.click();
    await page.waitForTimeout(400);
  }

  await priceField.blur();

  await expect
    .poll(
      async () => {
        for (const pin of uniqueUkPins(await paintedMarks(page))) {
          if (pin.id === firstPinId) continue;
          await dismissCuratedSheetIfOpen();
          await page.mouse.click(pin.x, pin.y);
          await page.waitForTimeout(500);
          if ((await sheet.count()) === 0) continue;
          const name = await sheetName();
          if (name && name !== firstName) return name;
        }
        try {
          await selectOtherUkBaseFromList();
        } catch {
          return null;
        }
        const name = await sheetName();
        if (name && name !== firstName) return name;
        return null;
      },
      {
        message: "a second UK base pub is reachable while the first sheet stays open",
        timeout: 90_000,
      },
    )
    .not.toBeNull();

  switched = true;

  const opened = firstName !== null;
  expect(opened, "a UK base pin should be tappable somewhere on a zoomed-in map").toBe(true);
  expect(switched, "a second, different UK base pin should be reachable from the first").toBe(true);

  // Pub B inherited nothing from pub A: no price, no receipt, no error.
  await expect(priceField).toHaveValue("");
  await expect(sheet.locator(".vpsubStamp")).toHaveCount(0);
  await expect(sheet.locator(".vpsubError")).toHaveCount(0);
  await expect(sheet).toContainText("No price yet");
  // ODbL attribution travels with the pins wherever they are displayed.
  await expect(sheet).toContainText("OpenStreetMap contributors");

  // The proof that base pubs stay OUT of the venue index - and therefore out of
  // search, the price filters and the crawl router. If one had leaked into
  // `venues`, the selection would resolve and the CURATED inspector would open
  // here instead of this sheet.
  await expect(page.locator(".venueInspector")).toHaveCount(0);
  expect(Number(await wrap.getAttribute("data-venue-count"))).toBeGreaterThanOrEqual(
    Number(curatedBefore),
  );

  // The flywheel: an unpriced pub takes a community price like any other.
  const logButton = sheet.getByRole("button", { name: "Log it" });
  await sheet.locator("input.vpsubInput").fill("4.20");
  await attachBill(sheet);
  await expect(logButton).toBeEnabled({ timeout: 20_000 });
  await expect(async () => {
    await logButton.click();
    await expect(sheet.locator(".vpsubStamp")).toContainText("£4.20", { timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  // (3) RESTORE. The tap wrote ?sel= plus its `at=` location hint; reloading
  // that URL must stream the pub's cell, fly the camera and reopen the SAME
  // unverified sheet - a shared base-pub link behaves like a curated one.
  const pubName = ((await sheet.locator(".unverifiedPubName").textContent()) ?? "").trim();
  expect(pubName.length).toBeGreaterThan(0);
  await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("sel=venue-uk-");
  expect(page.url()).toContain("at=");
  await page.goto(page.url());
  const restoredSheet = page.locator(".unverifiedPub");
  await expect(restoredSheet).toBeVisible({ timeout: 45_000 });
  await expect(restoredSheet.locator(".unverifiedPubName")).toHaveText(pubName);
});

// The desktop drawer names a base pub's sheet for its own OSM kind. It used to
// read the curated selection, which a base pub never has, so a search that
// opened the base twin of a curated pub landed in a sheet called "Venue detail".
for (const pub of [
  { id: "venue-uk-n352930271", at: "51.5003,-0.0842", name: "The Leather Exchange", label: "Pub detail" },
  { id: "venue-uk-n4470162948", at: "51.5002,-0.0765", name: "The Doodle Bar", label: "Bar detail" },
]) {
  test(`a base pub's desktop sheet is named ${pub.label}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/map?sel=${pub.id}&at=${pub.at}`);
    const sheet = page.getByRole("dialog", { name: pub.label, exact: true });
    await expect(sheet.locator(".unverifiedPubName")).toHaveText(pub.name, { timeout: 45_000 });
  });
}

test("a fresh national overview stays below the UK base gate and fetches no data", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const requests = ukBaseRequests(page);

  const response = await page.goto("/map?uk=1");
  expect(response?.status()).toBe(200);
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required", {
    timeout: 30_000,
  });
  await expect(wrap).toHaveAttribute("data-uk-base-count", "0");

  await page.waitForTimeout(1800);
  // The national gazetteer (places.json) loads for search and browse; below the
  // zoom gate the manifest and cell shards must stay unfetched.
  expect(requests.filter((url) => url.endsWith("places.json"))).toHaveLength(1);
  expect(
    requests.filter(
      (url) => !url.endsWith("places.json"),
    ),
  ).toEqual([]);
});
