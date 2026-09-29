import { expect, test, type Locator, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

async function prepareMap(page: Page, width: number, consent: boolean) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((showConsent) => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
    sessionStorage.removeItem("pubmax:prompt-budget:v1");
    sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    if (showConsent) localStorage.removeItem("pubmaxx:analytics-consent:v1");
    else localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, consent);

  await page.goto("/places");
  await expect(page.locator(".placesCityLink").first()).toBeVisible();
  await page.goto("/map/manchester");
  await expect(page.locator(".mapStage")).toBeVisible();
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
  await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(consent ? 1 : 0);
}

async function expectClearControl(page: Page, control: Locator, consentTop: number | null) {
  await expect(control).toBeVisible();
  const geometry = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { bottom: rect.bottom, centerHit: element.contains(hit) };
  });
  expect(geometry.centerHit).toBe(true);
  if (consentTop !== null) expect(geometry.bottom).toBeLessThan(consentTop);
}

for (const width of [390, 768, 1440]) {
  for (const consent of [true, false]) {
    test(`map bottom controls stay reachable at ${width}px with consent ${consent ? "present" : "absent"}`, async ({ page }) => {
      test.setTimeout(90_000);
      await prepareMap(page, width, consent);
      const consentTop = consent
        ? (await page.locator(".analyticsConsentPrompt").boundingBox())?.y ?? null
        : null;

      const documentSize = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
        bodyPadding: getComputedStyle(document.body).paddingBottom,
      }));
      expect(documentSize.scrollHeight).toBeLessThanOrEqual(documentSize.viewportHeight + 1);
      expect(documentSize.bodyPadding).toBe("0px");

      await expectClearControl(page, page.locator(".maplibregl-ctrl-attrib-button"), consentTop);
      if (width === 390) {
        const more = page.getByRole("button", { name: "More map controls" });
        await expectClearControl(page, more, consentTop);
        await expect(async () => {
          await more.click();
          await expect(page.locator('.mobileSheetPortal[data-sheet-kind="layers"]')).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        await page.getByRole("tab", { name: "Layers", exact: true }).click();
        await expect(page.getByRole("tab", { name: "Layers", exact: true })).toHaveAttribute("aria-selected", "true");
      } else {
        for (const zoom of ["zoom-in", "zoom-out"]) {
          await expectClearControl(page, page.locator(`.maplibregl-ctrl-${zoom}`), consentTop);
        }
        await expectClearControl(page, page.locator(".mapConciergeAskPill"), consentTop);
        const layers = page.locator(".mapLayersFab");
        await expectClearControl(page, layers, consentTop);
        await expect(async () => {
          await layers.click();
          await expect(page.locator(".mapLayersPanel")).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
      }
    });
  }
}
