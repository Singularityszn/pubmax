import { expect, test, type Page } from "@playwright/test";

import { expectMapLoadingFrameReleased, expectMobileMapShellReady } from "./helpers/mobileMapShell";

const HATTON = "venue-1vle947";

for (const viewport of [
  { name: "desktop", width: 1280, height: 800 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`${viewport.name} restored search keeps surrounding pins after the venue closes`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.goto(`/map?q=Hatton&sel=${HATTON}`);
    if (viewport.name === "phone") await expectMobileMapShellReady(page);
    await expectMapLoadingFrameReleased(page);
    await expect(page.getByRole("heading", { name: "The Sir Christopher Hatton", exact: true })).toBeVisible({ timeout: 30_000 });

    // The former idle query admitted only Hatton, whose pin sat below the
    // venue drawer. The query still narrows search, but nearby pins stay.
    await expect.poll(async () => Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count")))
      .toBeGreaterThan(1);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);

    const close = page.getByRole("button", { name: "Close pub detail", exact: true });
    await expect(async () => {
      await close.click();
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/map\?q=Hatton$/);
    await expect.poll(async () => page.evaluate(() => {
      const probe = (window as Window & {
        __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string }>;
      }).__pubmaxPaintedMapTapPoints;
      return probe?.().some((point) => point.kind === "cluster" ||
        (point.kind === "pin" && !point.id.startsWith("venue-uk-") && point.id !== "venue-1vle947")) ?? false;
    }), { timeout: 30_000, intervals: [1_000] }).toBe(true);

    await page.waitForTimeout(1_000);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);
    await page.reload();
    if (viewport.name === "phone") await expectMobileMapShellReady(page);
    await expectMapLoadingFrameReleased(page);
    await expect.poll(async () => Number(await page.locator(".mapCanvasWrap").getAttribute("data-venue-count")))
      .toBeGreaterThan(1);
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return Boolean(camera && !camera.moving && !camera.settling);
    })).toBe(true);
    await page.waitForTimeout(1_000);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expect(page.locator("#main")).not.toHaveAttribute("inert");
    await expect.poll(async () => page.evaluate(() => {
      const probe = (window as Window & {
        __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string }>;
      }).__pubmaxPaintedMapTapPoints;
      return probe?.().some((point) => point.kind === "cluster" ||
        (point.kind === "pin" && !point.id.startsWith("venue-uk-") && point.id !== "venue-1vle947")) ?? false;
    })).toBe(true);
    await expect(page).toHaveURL(/\/map\?q=Hatton$/);
    await expect(page.getByText("Visiting another city?", { exact: true })).toHaveCount(0);
  });
}

for (const selection of ["typed search", "venue suggestion", "base pub suggestion"] as const) {
  test(`a remote ${selection} takes the camera from Near me`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort());
    await page.addInitScript(() => {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    // Load the remote matches through a real arrival before comparing them
    // with Near me. Search suggestions alone do not load map venue shards.
    await page.goto("/map?q=Richmond");
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { center: number[]; moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return camera && !camera.moving && !camera.settling ? camera.center[0] : 0;
    }), { timeout: 30_000 }).toBeLessThan(-0.2);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await page.getByRole("button", { name: /^Map area:/ }).click();
    await context.setGeolocation({ latitude: 51.5074, longitude: -0.1278, accuracy: 10 });
    // A granted permission can start the banner's read immediately.
    // Supply coordinates first so that read never starts without a position.
    await context.grantPermissions(["geolocation"]);
    const useLocation = page.getByRole("button", { name: "Use my location", exact: true });
    await expect(async () => {
      await useLocation.click();
      await expect(page.getByRole("button", { name: "Map area: Near me. Change city", exact: true }))
        .toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { center: number[]; zoom: number; moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return Boolean(camera && !camera.moving && !camera.settling &&
        Math.abs(camera.center[0]! - (-0.1278)) < 0.001 && camera.zoom >= 13.5);
    })).toBe(true);

    const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
    await search.fill("Richmond");
    await expect(page.getByRole("listbox", { name: "Search suggestions" })
      .getByRole("option").filter({ hasText: "The Prince's Head, Richmond" }))
      .toBeVisible({ timeout: 30_000 });
    let selectedId: string | null = null;
    if (selection === "typed search") {
      await search.press("Escape");
      await page.getByRole("button", { name: "Drink: Pints", exact: true }).focus();
    } else {
      const group = selection === "venue suggestion" ? "Venues" : "Pubs on the map";
      const name = selection === "venue suggestion" ? "The Prince's Head, Richmond" : "The Richmond";
      const option = page.getByRole("listbox", { name: "Search suggestions" })
        .getByRole("group", { name: group, exact: true })
        .getByRole("option").filter({ hasText: selection === "base pub suggestion" ? /^The Richmond/ : name });
      await expect(option).toBeVisible();
      await option.click();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      selectedId = new URL(page.url()).searchParams.get("sel");
      expect(selectedId).not.toBeNull();
    }

    // Richmond's matches are west of the reader's Trafalgar Square fix.
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { center: number[]; zoom: number; moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return camera && !camera.moving && !camera.settling ? camera.center[0] : 0;
    }), { timeout: 15_000 }).toBeLessThan(-0.2);
    if (selection !== "typed search") {
      await page.getByRole("button", { name: "Close and return to the London map", exact: true }).click();
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    }
    await expect(page).toHaveURL(/\/map\?q=Richmond$/);
    if (selection === "typed search") return;
    const response = await page.request.get("/data/venues_slim.json");
    expect(response.ok()).toBe(true);
    const body = await response.json() as { rows: Array<{ id: string; cheapestPrice?: number }> };
    const pricedIds = body.rows.filter((row) => (row.cheapestPrice ?? 0) > 0 && row.id !== selectedId)
      .map((row) => row.id);
    const expectContextualPricePin = async () => {
      // A restored camera can report before the arriving scene has replaced
      // its opening pins. Do not tap a cluster from that earlier scene.
      await expect.poll(() => page.evaluate((ids) => {
        const camera = (window as Window & {
          __pubmaxMapCamera?: { read(): { center: number[]; moving: boolean; settling: boolean } };
        }).__pubmaxMapCamera?.read();
        const probe = (window as Window & {
          __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string; lng: number }>;
        }).__pubmaxPaintedMapTapPoints;
        return Boolean(camera && !camera.moving && !camera.settling && camera.center[0]! < -0.2 &&
          probe?.().some((point) => point.lng < -0.2 &&
            (point.kind === "cluster" || (point.kind === "pin" && ids.includes(point.id)))));
      }, pricedIds), { timeout: 30_000 }).toBe(true);
      const cluster = await page.evaluate((ids) => {
        const probe = (window as Window & {
          __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string; lng: number; x: number; y: number }>;
        }).__pubmaxPaintedMapTapPoints;
        const points = probe?.() ?? [];
        if (points.some((point) => point.kind === "pin" && point.lng < -0.2 && ids.includes(point.id))) return null;
        return points.find((point) => point.kind === "cluster" && point.lng < -0.2) ?? null;
      }, pricedIds);
      if (cluster) await page.mouse.click(cluster.x, cluster.y);
      await expect.poll(() => page.evaluate((ids) => {
        const probe = (window as Window & {
          __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; id: string; lng: number }>;
        }).__pubmaxPaintedMapTapPoints;
        return probe?.().some((point) => point.kind === "pin" && point.lng < -0.2 && ids.includes(point.id)) ?? false;
      }, pricedIds)).toBe(true);
    };
    await expectContextualPricePin();
    await page.reload();
    await expect.poll(async () => page.evaluate(() => {
      const camera = (window as Window & {
        __pubmaxMapCamera?: { read(): { center: number[]; moving: boolean; settling: boolean } };
      }).__pubmaxMapCamera?.read();
      return camera && !camera.moving && !camera.settling ? camera.center[0] : 0;
    }), { timeout: 30_000 }).toBeLessThan(-0.2);
    await expect(page).toHaveURL(/\/map\?q=Richmond$/);
    await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    await expectContextualPricePin();
  });
}

const CAMDEN = { latitude: 51.539, longitude: -0.1426 };

async function settledCamera(page: Page): Promise<{ lng: number; lat: number; zoom: number } | null> {
  return page.evaluate(() => {
    const camera = (window as Window & {
      __pubmaxMapCamera?: { read(): { center: number[]; zoom: number; moving: boolean; settling: boolean } };
    }).__pubmaxMapCamera?.read();
    return camera && !camera.moving && !camera.settling
      ? { lng: camera.center[0]!, lat: camera.center[1]!, zoom: camera.zoom }
      : null;
  });
}

async function openQuietMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*", (route) => ["GET", "HEAD"].includes(route.request().method())
    ? route.continue()
    : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

for (const commit of ["blur", "Enter"] as const) {
  test(`a Soho search typed under Near me around Camden releases Nearby on ${commit}`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await openQuietMap(page);
    await page.goto("/map?q=Soho");
    await expect.poll(async () => (await settledCamera(page))?.lat ?? 90, { timeout: 30_000 }).toBeLessThan(51.525);
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    await page.getByRole("button", { name: /^Map area:/ }).click();
    await context.setGeolocation({ ...CAMDEN, accuracy: 10 });
    await context.grantPermissions(["geolocation"]);
    const useLocation = page.getByRole("button", { name: "Use my location", exact: true });
    await expect(async () => {
      await useLocation.click();
      await expect(page.getByRole("button", { name: "Map area: Near me. Change city", exact: true }))
        .toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect.poll(async () => {
      const camera = await settledCamera(page);
      return Boolean(camera && Math.abs(camera.lng - CAMDEN.longitude) < 0.001 &&
        Math.abs(camera.lat - CAMDEN.latitude) < 0.001 && camera.zoom >= 13.5);
    }).toBe(true);

    const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
    const filters = page.getByRole("button", { name: /^Filters: venue types, view and zone/ });
    const filtersDialog = page.getByRole("dialog", { name: "Filters", exact: true });
    const pints = filtersDialog.getByRole("group", { name: "Venue types", exact: true })
      .getByRole("button", { name: "Pints", exact: true });
    const setPints = async (on: boolean) => {
      await filters.click();
      await expect(filtersDialog).toBeVisible();
      await expect(pints).toHaveAttribute("aria-pressed", String(!on));
      await pints.click();
      await expect(pints).toHaveAttribute("aria-pressed", String(on));
      await filters.click();
      await expect(filtersDialog).toHaveCount(0);
    };
    if (commit === "blur") await setPints(false);
    await search.fill("Soho");
    await expect(page.getByRole("listbox", { name: "Search suggestions" }).getByRole("option").first())
      .toBeVisible({ timeout: 30_000 });
    if (commit === "blur") {
      await search.press("Escape");
      await page.getByRole("button", { name: "Drink: Pints", exact: true }).focus();
    } else {
      await search.press("Enter");
    }
    if (commit === "blur") {
      await filters.click();
      await expect(filtersDialog).toBeVisible();
      await expect(pints).toHaveAttribute("aria-pressed", "false");
      await filters.click();
      await expect(filtersDialog).toHaveCount(0);
      await page.waitForTimeout(400);
      await expect(page.getByTestId("map-filter-empty")
        .getByRole("button", { name: /^Show (?:the matching pub|matching pubs)$/ })).toHaveCount(0);
      await setPints(true);
      await search.fill("");
      await search.fill("Soho");
      await expect(page.getByRole("listbox", { name: "Search suggestions" }).getByRole("option").first())
        .toBeVisible({ timeout: 30_000 });
      await search.press("Escape");
      await page.getByRole("button", { name: "Drink: Pints", exact: true }).focus();
    }

    await expect.poll(async () => (await settledCamera(page))?.lat ?? 90, { timeout: 15_000 }).toBeLessThan(51.525);
    if (commit === "blur") {
      await expect(page).toHaveURL(/\/map\?q=Soho$/);
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
      const canvas = await page.locator(".mapCanvasWrap").boundingBox();
      expect(canvas).not.toBeNull();
      const x = canvas!.x + canvas!.width / 2;
      const y = canvas!.y + canvas!.height / 2;
      const empty = page.getByTestId("map-filter-empty");
      await expect(async () => {
        await page.mouse.move(x, y - 150);
        await page.mouse.down();
        await page.mouse.move(x, y + 150, { steps: 12 });
        await page.mouse.up();
        await expect(empty).toBeVisible({ timeout: 3_000 });
        await expect.poll(async () => (await settledCamera(page))?.lat ?? 0, { timeout: 3_000 }).toBeGreaterThan(51.525);
      }).toPass({ timeout: 45_000 });
      await empty.getByRole("button", { name: /^Show (?:the matching pub|matching pubs)$/ }).click();
      await expect.poll(async () => (await settledCamera(page))?.lat ?? 90, { timeout: 15_000 }).toBeLessThan(51.525);
      await expect(empty).toHaveCount(0);
      await expect(page).toHaveURL(/\/map\?q=Soho$/);
      await expect(search).toHaveValue("Soho");
      await expect(page.locator("#main")).not.toHaveClass(/detail-open/);
    }
  });
}

test.describe("an opening location that answers late", () => {
  test.beforeEach(async ({ page, context }) => {
    await openQuietMap(page);
    await context.grantPermissions(["geolocation"]);
    await page.addInitScript(() => {
      localStorage.removeItem("pubmax:first-pins-seen:v1");
      const held: PositionCallback[] = [];
      const geolocation = {
        getCurrentPosition: (success: PositionCallback) => { held.push(success); },
        watchPosition: () => 1,
        clearWatch: () => {},
      };
      Object.defineProperty(Navigator.prototype, "geolocation", { configurable: true, get: () => geolocation });
      Object.assign(window, {
        __heldOpeningLocations: () => held.length,
        __answerOpeningLocation: (latitude: number, longitude: number) => {
          const answered = held.splice(0);
          for (const success of answered) {
            success({
              coords: {
                latitude, longitude, accuracy: 10, altitude: null, altitudeAccuracy: null,
                heading: null, speed: null, toJSON: () => ({}),
              },
              timestamp: Date.now(),
              toJSON: () => ({}),
            } as GeolocationPosition);
          }
          return answered.length;
        },
      });
    });
  });

  const heldRequests = (page: Page) => page.evaluate(() =>
    (window as Window & { __heldOpeningLocations?: () => number }).__heldOpeningLocations?.() ?? 0);
  const answerOpeningLocation = (page: Page) => page.evaluate(([latitude, longitude]) =>
    (window as Window & { __answerOpeningLocation?: (lat: number, lng: number) => number })
      .__answerOpeningLocation?.(latitude, longitude) ?? 0, [CAMDEN.latitude, CAMDEN.longitude] as const);

  test("still flies an untouched map to the reader", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await expect.poll(() => heldRequests(page), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await answerOpeningLocation(page)).toBeGreaterThan(0);
    await expect.poll(async () => {
      const camera = await settledCamera(page);
      return Boolean(camera && Math.abs(camera.lng - CAMDEN.longitude) < 0.002 &&
        Math.abs(camera.lat - CAMDEN.latitude) < 0.002);
    }, { timeout: 30_000 }).toBe(true);
  });

  test("leaves the reader's deliberate area pick in place", async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await expect.poll(() => heldRequests(page), { timeout: 30_000 }).toBeGreaterThan(0);
    const search = page.getByRole("combobox", { name: "Search pubs", exact: true });
    await expect(search).toBeEditable({ timeout: 60_000 });
    await search.fill("Richmond");
    const areaOption = page.getByRole("listbox", { name: "Search suggestions" })
      .getByRole("group", { name: "Areas", exact: true })
      .getByRole("option").filter({ hasText: /Richmond/ }).first();
    await expect(areaOption).toBeVisible({ timeout: 30_000 });
    await areaOption.click();
    await expect.poll(async () => (await settledCamera(page))?.lng ?? 0, { timeout: 30_000 }).toBeLessThan(-0.2);
    const picked = await settledCamera(page);
    expect(picked).not.toBeNull();

    expect(await answerOpeningLocation(page)).toBeGreaterThan(0);
    await page.waitForTimeout(2_000);
    await expect.poll(() => settledCamera(page)).not.toBeNull();
    const after = await settledCamera(page);
    expect(after!.lng).toBeLessThan(-0.2);
    expect(Math.abs(after!.lng - picked!.lng)).toBeLessThan(0.001);
    expect(Math.abs(after!.lat - picked!.lat)).toBeLessThan(0.001);
  });
});
