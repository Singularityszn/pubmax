import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

// The first-visit ask is a compact pill docked low on a phone, and
// no surface may make the map inert (components/AGENTS.md, "THE ARRIVAL ASK IS
// A STRIP"). So the chrome stays live beside the strip, and the strip is the
// one banner on screen until the reader answers it.

const LIVE_CONTROLS = [
  ".mobileMapTopbar button",
  ".mobileMapChipRow button",
  ".mobileMapUtilityCorner > button",
  ".mobilePlanActivation button",
  ".mapArrivalCard button",
] as const;

/** Controls whose own centre answers some other element: covered, so untappable. */
async function coveredControls(page: Page): Promise<string[]> {
  return page.evaluate((selectors) => {
    const covered: string[] = [];
    for (const selector of selectors) {
      for (const control of document.querySelectorAll<HTMLElement>(selector)) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        if (hit && (hit === control || control.contains(hit))) continue;
        covered.push(
          `${selector} "${control.getAttribute("aria-label") ?? control.textContent?.trim()}"`,
        );
      }
    }
    return covered;
  }, LIVE_CONTROLS);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px cold map keeps First visit as the one banner, under live chrome`, async ({
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
    await expect(page.locator(".mapCameraControls")).toBeHidden();
    await expect(page.locator(".maplibregl-ctrl-top-right")).toBeHidden();

    // The ask is a compact pill docked low, so the upper map stays clear: the
    // question and the location action on one row, the location sentence the
    // store copy is paired to under them, and "Choose an area" left to the
    // city switcher on a phone.
    await expect(page.locator(".mobileMapChipRow")).toBeVisible();
    const arrivalBox = await arrival.boundingBox();
    expect(arrivalBox).not.toBeNull();
    expect(arrivalBox!.height).toBeLessThanOrEqual(80);
    const lead = arrival.getByText("Location is used only while the map is open.");
    await expect(lead).toBeVisible();
    const leadBox = await lead.boundingBox();
    expect(leadBox!.height).toBeGreaterThan(8);
    expect(leadBox!.y + leadBox!.height).toBeLessThanOrEqual(arrivalBox!.y + arrivalBox!.height);
    expect(arrivalBox!.y + arrivalBox!.height / 2).toBeGreaterThan(viewport.height / 2);
    // Both answers are visible side by side: the filled primary and the quiet
    // "Choose an area" beside it, on one row.
    const useMine = arrival.getByRole("button", { name: "Use my location" });
    const chooseArea = arrival.getByRole("button", { name: "Choose an area" });
    await expect(useMine).toBeVisible();
    await expect(chooseArea).toBeVisible();
    const [mineBox, areaBox] = [(await useMine.boundingBox())!, (await chooseArea.boundingBox())!];
    expect(Math.abs(mineBox.y - areaBox.y)).toBeLessThan(2);
    expect(mineBox.height).toBeGreaterThanOrEqual(44);
    expect(areaBox.height).toBeGreaterThanOrEqual(44);

    // One banner at a time: every ambient banner waits for the answer.
    for (const banner of [
      ".citySuggestBanner",
      ".cityStatusBanner",
      ".cityStatusStack",
      ".palSummon",
      ".tonightLaneCollapsed",
      ".mapConciergeAsk",
    ]) {
      await expect(page.locator(banner), banner).toBeHidden();
    }

    // The chrome and the map stay live, and nothing covers a control.
    await expect(page.locator(".mobileMapUtilityCorner")).toBeVisible();
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    await expect(page.locator(".mobileMapChrome")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".mapCanvasWrap")).not.toHaveAttribute("inert", "");
    expect(await coveredControls(page)).toEqual([]);

    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toHaveCount(0);
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    await expect(page.locator(".mobileMapChrome")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".mapCanvasWrap")).not.toHaveAttribute("inert", "");
  });
}
