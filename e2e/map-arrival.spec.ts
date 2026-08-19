import { expect, test, type Page } from "@playwright/test";

const MAP_FIRST_VISIT_KEY = "pubmax:map-first-visit-arrival:v1";
const MAP_CHOSEN_AREA_KEY = "pubmax:map-chosen-area:v1";

async function armPinReveal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const revealWindow = window as typeof window & {
      __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
    };
    if (!revealWindow.__pubmaxPinRevealTrace) {
      const trace: Array<{ reason: string; generation: number }> = [];
      revealWindow.__pubmaxPinRevealTrace = trace;
      window.addEventListener("pubmax:pin-reveal", (event) => {
        trace.push(
          (event as CustomEvent<{ reason: string; generation: number }>).detail,
        );
      });
    }
  });
}

async function waitForPins(page: Page): Promise<void> {
  await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 45_000 });
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __pubmaxPinRevealTrace?: unknown[];
              }
            ).__pubmaxPinRevealTrace?.length ?? 0,
        ),
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);
}

async function prepareFirstVisitMap(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await armPinReveal(page);
  await page.addInitScript((keys) => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    if (!window.sessionStorage.getItem("pubmax-map-arrival-e2e-prepared")) {
      window.localStorage.removeItem(keys.arrival);
      window.localStorage.removeItem(keys.chosen);
      window.sessionStorage.setItem("pubmax-map-arrival-e2e-prepared", "1");
    }
  }, { arrival: MAP_FIRST_VISIT_KEY, chosen: MAP_CHOSEN_AREA_KEY });
}

test.describe("map first-visit arrival", () => {
  test("choose area remembers Camden and hides the card on return", async ({
    page,
  }) => {
    await prepareFirstVisitMap(page);
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await arrival.getByRole("button", { name: "Choose an area" }).click();

    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="choose-area"]');
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    await sheet.getByRole("button", { name: /^Camden/ }).click();
    await expect(sheet).toBeHidden({ timeout: 15_000 });
    await expect(arrival).toBeHidden();

    await expect(
      page.locator(".citySwitcher--mobile .citySwitcherLabelFull"),
    ).toHaveText("Camden");

    const stored = await page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }, MAP_CHOSEN_AREA_KEY);
    expect(stored).toMatchObject({ label: "Camden", slug: "camden", kind: "night-area" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);
    await expect(page.locator(".mapArrivalCard")).toBeHidden();
    await expect(
      page.locator(".citySwitcher--mobile .citySwitcherLabelFull"),
    ).toHaveText("Camden");
  });

  test("desktop arrival card offers location and choose area", async ({ page }) => {
    await prepareFirstVisitMap(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 45_000 });
    await waitForPins(page);

    const arrival = page.locator(".mapArrivalCard");
    await expect(arrival).toBeVisible({ timeout: 15_000 });
    await expect(arrival.getByRole("button", { name: "Use my location" })).toBeVisible();
    await expect(arrival.getByRole("button", { name: "Choose an area" })).toBeVisible();
    await arrival.getByRole("button", { name: "Close" }).click();
    await expect(arrival).toBeHidden();
  });
});
