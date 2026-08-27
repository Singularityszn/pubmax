import { expect, test, type Page } from "@playwright/test";

// The UK base layer's two load-bearing promises, asserted in a real browser
// with a real MapLibre canvas (this spec runs in the `chromium-gl` project):
//
//   1. NORMAL ENTRY. London starts at UK_BASE_MIN_ZOOM, loads its bounded
//      viewport shards, and publishes a ready state.
//   2. PAYLOAD. A restored camera below UK_BASE_MIN_ZOOM fetches nothing under
//      /data/uk_base/ and publishes zoom_required.
//   3. THE FLYWHEEL. A base pub opens the unverified sheet with the
//      price-submission card on it - an unpriced pub is where the first price
//      is worth the most.
//
// `data-uk-base-count` and `data-uk-base-status` on .mapCanvasWrap make the
// layer observable from outside MapLibre.

const VIEWPORT = { width: 390, height: 844 };

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
  });
});

test("loads London base pubs on normal entry, then paints and takes a price", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const requests = ukBaseRequests(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toBeVisible({ timeout: 20_000 });
  const curatedBefore = await wrap.getAttribute("data-venue-count");

  // (1) London starts at the stream gate, so a normal entry loads a bounded
  // viewport without requiring a hidden zoom gesture.
  await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", {
    timeout: 30_000,
  });
  await expect
    .poll(async () => Number(await wrap.getAttribute("data-uk-base-count")), { timeout: 30_000 })
    .toBeGreaterThan(0);

  // The manifest is fetched once, and only cells the viewport covers follow it.
  expect(requests.filter((url) => url.endsWith("manifest.json"))).toHaveLength(1);
  expect(requests.length).toBeGreaterThan(1);
  expect(requests.length).toBeLessThanOrEqual(8);

  // (3) A base pin opens the unverified sheet, and moving the selection STRAIGHT
  // from one base pub to another hands the second one a clean form. A price
  // typed for pub A that survives into pub B's form is a wrong price one tap
  // from being submitted, so the transition is driven here through a single
  // mounted sheet - pub A, type, tap pub B, with no close in between - rather
  // than asserted on a React key that would pass either way.
  //
  // Pin positions are data-dependent, so sweep rather than hard-coding a pixel a
  // data refresh would move. Empty canvas clicks fall through inertly
  // (components/map/canvas/interactions.ts), which is what lets the sweep keep
  // hunting while the sheet stays mounted. A curated pin DOES replace the sheet;
  // that ends the mounted chain, so the sweep escapes it and starts over.
  const sheet = page.locator(".unverifiedPub");
  const priceField = sheet.getByRole("textbox");
  const TYPED_PRICE = "9.90";
  let firstName: string | null = null;
  let switched = false;

  async function sheetName(): Promise<string> {
    return ((await sheet.locator(".unverifiedPubName").textContent()) ?? "").trim();
  }

  for (let y = 200; y < 620 && !switched; y += 20) {
    for (let x = 24; x < 366 && !switched; x += 20) {
      await page.mouse.click(x, y);
      await page.waitForTimeout(90);

      // Order matters: the unverified sheet rides in the same mobile sheet
      // portal a curated venue uses, so it must be recognised FIRST.
      if ((await sheet.count()) === 0) {
        if (await page.locator('.mobileSheetPortal[data-sheet-kind="venue"]').count()) {
          // A curated pin took the sheet. The A-to-B chain is broken; forget A.
          await page.keyboard.press("Escape");
          await page.waitForTimeout(120);
          firstName = null;
        }
        continue;
      }

      const name = await sheetName();
      if (!name) continue;
      if (firstName === null) {
        firstName = name;
        await priceField.fill(TYPED_PRICE);
        await expect(priceField).toHaveValue(TYPED_PRICE);
        continue;
      }
      if (name !== firstName) switched = true;
    }
  }
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
  await sheet.getByRole("textbox").fill("4.20");
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet.locator(".vpsubStamp")).toContainText("£4.20", { timeout: 15_000 });

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

test("restored London camera below the stream gate fetches no UK Base data", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const requests = ukBaseRequests(page);

  await page.goto("/map");
  const wrap = page.locator(".mapCanvasWrap");
  await expect(wrap).toHaveAttribute("data-uk-base-status", "ready", {
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("pubmaxx.mobile-map-session.v1"),
      ),
    )
    .not.toBeNull();

  await page.evaluate(() => {
    const key = "pubmaxx.mobile-map-session.v1";
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "null") as {
      viewport?: { center?: [number, number]; zoom?: number; pitch?: number; bearing?: number };
      selectedVenueId?: string | null;
      openSheet?: string | null;
    } | null;
    if (!raw) throw new Error("mobile map session missing");
    raw.viewport = {
      center: [-0.12, 51.52],
      zoom: 11,
      pitch: 38,
      bearing: -8,
    };
    raw.selectedVenueId = null;
    raw.openSheet = null;
    window.localStorage.setItem(key, JSON.stringify(raw));
  });
  requests.length = 0;

  await page.reload();
  await expect(wrap).toHaveAttribute("data-uk-base-status", "zoom_required", {
    timeout: 20_000,
  });
  await expect(wrap).toHaveAttribute("data-uk-base-count", "0");
  expect(requests).toEqual([]);
});
