import { expect, test, type Page, type Response as PlaywrightResponse } from "@playwright/test";
import { attachBill } from "./helpers/priceBill";
import { MAP_CHOSEN_AREA_KEY } from "../lib/mapChosenArea";
import { parseUkBaseShard, type UkBasePub } from "../lib/ukBasePubs";

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
  // Observe only packs the real arrival already requests. Do not fetch or
  // inject a fixture route to make the chosen pubs available.
  const publicBaseRows = new Map<string, UkBasePub>();
  const shardReads: Promise<void>[] = [];
  const observeArrivalShard = (response: PlaywrightResponse) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/data/uk_base/packs/") || !path.endsWith(".json") || !response.ok()) return;
    shardReads.push(response.json().then((body: unknown) => {
      for (const pub of parseUkBaseShard(body)) publicBaseRows.set(pub.id, pub);
    }));
  };
  page.on("response", observeArrivalShard);

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
  // Let the curated pack populate before selecting a base pub, so an
  // overlapping curated identity has reached the ordinary pin router.
  await expect
    .poll(async () => Number(await wrap.getAttribute("data-venue-count")), { timeout: 30_000 })
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

  // This source-qualified pair has no curated owner. An arbitrary edge
  // pub can focus a viewport with no second operable base pin.
  const firstId = "venue-uk-n33101954"; // Turnpike House
  const secondId = "venue-uk-w640280851"; // The Axe
  page.off("response", observeArrivalShard);
  await Promise.all(shardReads);
  for (const id of [firstId, secondId]) {
    const pub = publicBaseRows.get(id);
    expect(pub, `${id} must come from an arrival's actual public shard`).toBeDefined();
    expect(pub?.curatedVenueId, `${id} must be base-only`).toBe("");
    expect(pub?.kind).toBe("pub");
  }
  let firstPinId: string | null = null;

  await expect
    .poll(
      async () => {
        const pin = uniqueUkPins(await paintedMarks(page)).find((mark) => mark.id === firstId);
        if (!pin) return null;
        await page.mouse.click(pin.x, pin.y);
        await page.waitForTimeout(400);
        if ((await sheet.count()) === 0) return null;
        const name = await sheetName();
        const sel = new URL(page.url()).searchParams.get("sel");
        if (sel !== firstId || !name) return null;
        firstPinId = sel;
        firstName = name;
        await priceField.fill(TYPED_PRICE);
        await expect(priceField).toHaveValue(TYPED_PRICE);
        return name;
      },
      {
        message: "the base-only Turnpike House pin opens the unverified price sheet",
        timeout: 90_000,
      },
    )
    .not.toBeNull();

  expect(firstPinId).toBe(firstId);
  await expect(page.locator(".venueInspector")).toHaveCount(0);
  await priceField.blur();

  await expect
    .poll(
      async () => {
        // A selection moves the camera. Read B's current painted coordinates
        // while retaining the same mounted A sheet and typed price.
        const pin = uniqueUkPins(await paintedMarks(page)).find((mark) => mark.id === secondId);
        if (!pin) return null;
        await page.mouse.click(pin.x, pin.y);
        await page.waitForTimeout(500);
        if ((await sheet.count()) === 0) return null;
        const name = await sheetName();
        const sel = new URL(page.url()).searchParams.get("sel");
        if (sel === secondId && sel !== firstPinId && name && name !== firstName) return name;
        return null;
      },
      {
        message: "The Axe base pin is reachable while the Turnpike House sheet stays open",
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

test("selecting Gin keeps street-level UK pub presence available", async ({ page }) => {
  const requests = ukBaseRequests(page);
  const response = await page.goto("/map?drink=gin");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("button", {
    name: "Drink shown on the map: Gin. Choose another drink", exact: true,
  })).toBeVisible();
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", { timeout: 30_000 });
  await expect.poll(async () => Number(await wrap.getAttribute("data-uk-base-count")), {
    timeout: 30_000,
  }).toBeGreaterThan(0);
  expect(requests.some((path) => path.endsWith("manifest.json"))).toBe(true);
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 10_000 });
});

for (const viewport of [VIEWPORT, { width: 1440, height: 900 }]) {
  for (const experience of ["all", "food", "no-alcohol"] as const) {
    test(`a fresh national ${experience} overview becomes usable without pub data at ${viewport.width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.addInitScript((key) => {
        window.localStorage.setItem(key, JSON.stringify({
          cityId: "london",
          kind: "night-area",
          label: "Piccadilly & Soho",
          slug: "piccadilly-soho",
          center: [-0.1344, 51.5136],
        }));
      }, MAP_CHOSEN_AREA_KEY);
      const requests = ukBaseRequests(page);
      const curatedRequests: string[] = [];
      page.on("request", (request) => {
        const pathname = new URL(request.url()).pathname;
        if (pathname.startsWith("/data/venues_slim")) curatedRequests.push(pathname);
      });

      const response = await page.goto(`/map?uk=1&experience=${experience}`);
      expect(response?.status()).toBe(200);
      const wrap = page.locator(".mapCanvasWrap");
      await expect(wrap).toHaveAttribute("data-uk-base-status", experience === "all" ? "zoom_required" : "suspended", {
        timeout: 30_000,
      });
      await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 10_000 });
      if (viewport.width < 768) {
        const searchToggle = page.getByRole("button", { name: "Search the map", exact: true });
        await expect(async () => {
          if (await searchToggle.getAttribute("aria-expanded") !== "true") {
            await searchToggle.click();
          }
          await expect(searchToggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        const searchInput = page.getByRole("combobox", { name: "Search pubs", exact: true });
        await expect(searchInput).toBeVisible();
        await expect(searchInput).toBeEditable();
        await page.keyboard.press("Escape");
        await expect(searchToggle).toHaveAttribute("aria-expanded", "false");
        await expect(searchInput).toHaveCount(0);
        await expect(searchToggle).toBeFocused();
      } else {
        await expect(page.getByRole("combobox", { name: "Search pubs" })).toBeVisible();
      }
      await expect(page.getByRole("button", {
        name: "Map area: UK. Change city", exact: true,
      })).toBeVisible();
      await expect(page.getByText("Zoom in to load pubs on the map.", { exact: false })).toBeVisible();

      await page.waitForTimeout(1800);
      // The national gazetteer (places.json) loads for search and browse; below the
      // zoom gate the manifest and cell shards must stay unfetched.
      expect(requests.filter((url) => url.endsWith("places.json"))).toHaveLength(1);
      expect(
        requests.filter(
          (url) => !url.endsWith("places.json"),
        ),
      ).toEqual([]);
      expect(curatedRequests).toEqual([]);
      await testInfo.attach("national-overview", { body: await page.screenshot(), contentType: "image/png" });

      if (experience !== "all" || viewport.width !== 1440) return;

      const cityTrigger = page.getByRole("button", {
        name: "Map area: UK. Change city", exact: true,
      });
      const cityMenu = page.getByRole("listbox", { name: "Choose city map" });
      await expect(async () => {
        await cityTrigger.click();
        await expect(cityMenu).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });

      const areaDialog = page.locator('.chooseAreaDesktop[role="dialog"]');
      await expect(async () => {
        await cityMenu.getByRole("button", { name: "This area", exact: true }).click();
        await expect(areaDialog).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await expect(areaDialog.getByRole("heading", { name: "Choose an area" })).toBeVisible();

      await expect(async () => {
        await areaDialog.getByRole("button", { name: /^Camden/ }).click();
        await expect(areaDialog).toBeHidden({ timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
      await expect(page.getByRole("button", {
        name: "Map area: Camden. Change city", exact: true,
      })).toBeVisible();
      await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", {
        timeout: 30_000,
      });
      await expect
        .poll(async () => Number(await wrap.getAttribute("data-uk-base-count")), {
          timeout: 30_000,
        })
        .toBeGreaterThan(0);
      await testInfo.attach("national-to-camden", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }
}
