import { expect, test, type Page } from "@playwright/test";
import { expectMapLoadingFrameReleased, expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

test("city changes retain one map and the destination coverage note", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installDeterministicMapBasemap(page);
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const identityErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /same key|duplicate key/i.test(message.text())) identityErrors.push(message.text());
  });
  page.on("pageerror", error => identityErrors.push(error.message));
  await page.goto("/map/london");
  await expectMobileMapShellReady(page);
  await page.locator(".mapStage").evaluate(element => element.setAttribute("data-identity-proof", "london"));
  await page.locator(".mobileMapTopbar").getByRole("button", { name: /^Map area:/ }).click();
  await expect(page.getByRole("listbox", { name: "Choose city map" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "Choose city map" })).toHaveCount(0);
  await expect(page.locator(".mapStage")).toHaveAttribute("data-identity-proof", "london");

  for (const city of ["Manchester", "Glasgow", "London", "Manchester"]) {
    const area = page.locator(".mobileMapTopbar").getByRole("button", { name: /^Map area:/ });
    await area.click();
    const menu = page.getByRole("listbox", { name: "Choose city map" });
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: city, exact: true }).click();
    await expectMobileMapShellReady(page);
    await expect(area).toHaveAccessibleName(new RegExp(`Map area: ${city}\\. Change city`));
    await expect(page.locator(".mapStage")).toHaveCount(1);
    await expect(page.locator(".maplibregl-canvas")).toHaveCount(1);
    if (city === "London") {
      await expect(page.locator(".cityPubsOnlyNote")).toHaveCount(0);
    } else {
      await expect(page.locator(".cityPubsOnlyNote")).toHaveCount(1);
      await expect(page.locator(".cityPubsOnlyNote")).toBeVisible();
      await expect(page.locator(".cityPubsOnlyNote")).toContainText("Pubs only here, no prices yet.");
    }
    await test.info().attach(`city-${city}`, { body: await page.screenshot(), contentType: "image/png" });
    await expect(page.locator(".mapStage")).not.toHaveAttribute("data-identity-proof", "london");
  }
  expect(identityErrors).toEqual([]);
});

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

    await expectMapLoadingFrameReleased(page);
    await expectMobileMapShellReady(page);
    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible();
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
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
    // docs/rules/components-sheets-chrome-and-navigation.md, "THE ARRIVAL ASK IS A STRIP":
    // the compact ask parks one gap above the map-edge column's published top.
    // mapArrivalCard.css owns that berth. The Plan rail and dock bound the
    // usable map too. A multirow dock lifts the band, not the viewport midpoint.
    const upperChrome = (await page.locator(".mobileMapChipRow").boundingBox())!;
    const nearMeControl = await mobileMapShellControl(page, "nearMe");
    const nearMe = (await nearMeControl.boundingBox())!;
    const gap = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--float-stack-gap")));
    expect(Number.isFinite(gap)).toBe(true);
    expect(gap).toBeGreaterThan(0);
    const usableTop = upperChrome.y + upperChrome.height;
    const plan = (await page.locator(".mobilePlanActivation").boundingBox())!;
    const dock = (await page.locator(".mobileTabBar").boundingBox())!;
    expect(plan).not.toBeNull();
    expect(dock).not.toBeNull();
    const usableBottom = Math.min(nearMe.y, plan.y, dock.y) - gap;
    expect(usableBottom).toBeGreaterThan(usableTop);
    expect(arrivalBox!.y).toBeGreaterThanOrEqual(usableTop);
    expect(arrivalBox!.y + arrivalBox!.height).toBeLessThanOrEqual(usableBottom);
    expect(arrivalBox!.y + arrivalBox!.height / 2).toBeGreaterThan((usableTop + usableBottom) / 2);
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
    await test.info().attach("first-visit-strip-and-live-controls", { body: await page.screenshot(), contentType: "image/png" });

    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toHaveCount(0);
    await expect(page.locator(".mobilePlanActivation")).toBeVisible();
    await expect(page.locator(".mobileMapChrome")).not.toHaveAttribute("inert", "");
    await expect(page.locator(".mapCanvasWrap")).not.toHaveAttribute("inert", "");
  });
}
