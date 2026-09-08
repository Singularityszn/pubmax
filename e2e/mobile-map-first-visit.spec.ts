import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectReachable(control: Locator) {
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toBeInViewport();
  expect(await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !element.closest("[inert]") && hit !== null && element.contains(hit);
  }), "the visible control owns its tap point and has no inert ancestor").toBe(true);
}

async function expectLiveMap(page: Page) {
  await expect(page.locator(".mobileMapChrome")).not.toHaveAttribute("inert");
  await expect(page.locator(".mapCanvasWrap")).not.toHaveAttribute("inert");
  await expect.poll(() => page.evaluate(() => {
    const map = window as typeof window & {
      __pubmaxPaintedMapTapPoints?: () => Array<{ kind: string; x: number; y: number }>;
    };
    const canvas = document.querySelector(".maplibregl-canvas");
    if (!canvas || canvas.closest("[inert]")) return 0;
    // The published probe returns only placed, unobstructed pins or clusters.
    return (map.__pubmaxPaintedMapTapPoints?.() ?? []).filter((point) =>
      (point.kind === "pin" || point.kind === "cluster") &&
      document.elementFromPoint(point.x, point.y) === canvas,
    ).length;
  })).toBeGreaterThan(0);
}

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px cold map keeps the first-visit strip above reachable controls and pins`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
      window.localStorage.removeItem("pubmax:map-chosen-area:v1");
    });

    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    await expect(page.locator(".mobileMapTopbar")).toBeVisible({
      timeout: 45_000,
    });
    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(".mobileMapTopbar")).toHaveCount(1);
    await expect(page.locator(".mobileMapChipRow")).toBeVisible();
    await expect(page.locator(".mobileMapUtilityCorner")).toBeVisible();
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    // MapLibre's unused control group stays hidden on phones, independent of arrival.
    await expect(page.locator(".maplibregl-ctrl-top-right")).toBeHidden();
    await expectLiveMap(page);

    const controls = page.locator([
      ".mobileMapTopbar button", ".mobileMapChipRow button",
      ".mobileMapUtilityCorner button", ".mobilePlanActivation", ".mapArrivalCard button",
    ].join(", "));
    expect(await controls.count()).toBeGreaterThan(0);
    for (const control of await controls.all()) await expectReachable(control);

    const chrome = await page.locator(".mobileMapChrome").boundingBox();
    const strip = await arrival.boundingBox();
    const plan = await page.locator(".mobilePlanActivation").boundingBox();
    const nav = await page.getByRole("navigation", { name: "Primary", exact: true }).boundingBox();
    expect(chrome).not.toBeNull();
    expect(strip).not.toBeNull();
    expect(plan).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(strip!.y).toBeGreaterThanOrEqual(chrome!.y + chrome!.height);
    expect(strip!.height).toBeLessThanOrEqual(132);
    expect(strip!.x).toBeGreaterThanOrEqual(0);
    expect(strip!.x + strip!.width).toBeLessThanOrEqual(viewport.width);
    expect(strip!.y + strip!.height).toBeLessThan(plan!.y);
    expect(plan!.y + plan!.height).toBeLessThanOrEqual(nav!.y);

    // The lower map lane above the plan action must receive the tap itself.
    const lowerMapPoint = { x: viewport.width / 2, y: plan!.y - 12 };
    expect(lowerMapPoint.y).toBeGreaterThan(strip!.y + strip!.height);
    expect(await page.evaluate(({ x, y }) =>
      document.elementFromPoint(x, y)?.matches(".maplibregl-canvas") === true,
    lowerMapPoint)).toBe(true);

    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toHaveCount(0);
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    await expectLiveMap(page);
    const search = page.getByRole("button", { name: "Search the map", exact: true });
    await expectReachable(search);
    await search.click();
    await expect(page.getByRole("combobox", { name: "Search pubs", exact: true })).toBeVisible();
  });
}
