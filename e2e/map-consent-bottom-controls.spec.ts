import { expect, test, type Locator, type Page } from "@playwright/test";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

// The production service worker registers on /places and then answers basemap
// requests itself, past page.route(), so the refused raster tiles never fail.
test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block" });

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
  if (consent) await expect(page.locator(".analyticsConsentPrompt")).toBeVisible();
}

for (const width of [390, 768, 1440]) {
  test(`basemap Retry stays reachable above consent at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await installDeterministicMapBasemap(page, { failPrimaryRasterRequests: 10_000 });
    await prepareMap(page, width, true);
    const retry = page.locator(".mapSoftRetryBtn");
    await expect(retry).toBeVisible({ timeout: 45_000 });
    const consentTop = (await page.locator(".analyticsConsentPrompt").boundingBox())!.y;
    await page.screenshot({ path: testInfo.outputPath(`retry-consent-${width}.png`) });
    await testInfo.attach("retry-hit-target", {
      body: JSON.stringify(await retry.evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return { bounds: bounds.toJSON(), hit: hit?.outerHTML, reachable: node.contains(hit) };
      }), null, 2),
      contentType: "application/json",
    });
    await expectClearControl(page, retry, consentTop);
    await installDeterministicMapBasemap(page);
    await retry.click();
    await expect(retry).toBeHidden({ timeout: 45_000 });
    await expect(page.locator(width === 390 ? ".mobileMapTopbar" : ".mapToolbar")).toBeVisible();
    await expect(page.getByLabel("Anonymous analytics choice")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`retry-recovered-${width}.png`) });
  });
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
    test(`map bottom controls stay reachable at ${width}px with consent ${consent ? "present" : "absent"}`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await prepareMap(page, width, consent);
      const consentTop = consent
        ? (await page.locator(".analyticsConsentPrompt").boundingBox())!.y
        : null;
      if (consent) {
        const prompt = page.getByLabel("Anonymous analytics choice");
        await expect(prompt).toBeVisible();
        await expect(prompt).toHaveCSS("position", "fixed");
        await expect(prompt).toHaveCSS("border-radius", "0px");
        await expect(prompt).toHaveCSS("box-shadow", "none");
        await expect(prompt).toHaveCSS("backdrop-filter", "none");
        const box = (await prompt.boundingBox())!;
        expect(box.x).toBeCloseTo(0, 0);
        expect(box.width).toBeCloseTo(width, 0);
        const paragraph = prompt.locator("p");
        // Privacy has an enlarged tap target that intentionally exceeds the
        // paragraph box. Measure painted text, not that target's scroll area.
        expect(await paragraph.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const rects: DOMRect[] = [];
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            rects.push(...range.getClientRects());
          }
          return rects.length > 0 && rects.every((rect) =>
            rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 &&
            rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1 &&
            [rect.left + 1, rect.right - 1].every((x) =>
              element.contains(document.elementFromPoint(x, rect.top + rect.height / 2)),
            ),
          );
        })).toBe(true);
        const dockTop = width === 390
          ? (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!.y
          : 900;
        expect(box.y + box.height).toBeLessThanOrEqual(dockTop);
        expect(dockTop - box.y - box.height).toBeLessThanOrEqual(12);
        const scrollPadding = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingBottom));
        expect(scrollPadding).toBeGreaterThanOrEqual(900 - box.y);
      }

      const documentSize = await page.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: innerHeight,
        bodyPadding: getComputedStyle(document.body).paddingBottom,
        stageBottom: document.querySelector(".mapStage")!.getBoundingClientRect().bottom,
      }));
      expect(documentSize.scrollHeight).toBeLessThanOrEqual(documentSize.viewportHeight + 1);
      expect(documentSize.bodyPadding).toBe("0px");
      expect(documentSize.stageBottom).toBeCloseTo(documentSize.viewportHeight, 0);
      await page.screenshot({ path: testInfo.outputPath(`map-controls-${width}-consent-${consent}.png`) });

      await expectClearControl(page, page.locator(".maplibregl-ctrl-attrib-button"), consentTop);
      await page.locator(".maplibregl-ctrl-attrib-button").click();
      await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toBeVisible();
      await page.locator(".maplibregl-ctrl-attrib-button").click();
      if (width === 390) {
        const more = page.getByRole("button", { name: "More map controls" });
        await expectClearControl(page, more, consentTop);
        await expect(async () => {
          await more.click();
          await expect(page.locator('.mobileSheetPortal[data-sheet-kind="layers"]')).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        await expect(page.locator(".mobileMapCredits")).toContainText("OpenStreetMap contributors (ODbL)");
        await page.getByRole("tab", { name: "Layers", exact: true }).click();
        await expect(page.getByRole("tab", { name: "Layers", exact: true })).toHaveAttribute("aria-selected", "true");
      } else {
        for (const zoom of ["zoom-in", "zoom-out"]) {
          await expectClearControl(page, page.locator(`.maplibregl-ctrl-${zoom}`), consentTop);
          await page.locator(`.maplibregl-ctrl-${zoom}`).click();
        }
        await expectClearControl(page, page.locator(".mapConciergeAskPill"), consentTop);
        await page.locator(".mapConciergeAskPill").click();
        await expect(page.getByRole("dialog", { name: "Ask your Pub Pal" })).toBeVisible();
        await page.getByRole("button", { name: "Close ask", exact: true }).click();
        const layers = page.locator(".mapLayersFab");
        await expectClearControl(page, layers, consentTop);
        await expect(async () => {
          await layers.click();
          await expect(page.locator(".mapLayersPanel")).toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
      }

      if (consent) {
        await page.keyboard.press("Escape");
        const prompt = page.getByLabel("Anonymous analytics choice");
        await expect(prompt).toBeVisible();
        const allow = width === 768;
        await prompt.getByRole("button", { name: allow ? "Allow" : "No thanks", exact: true }).click();
        await expect(prompt).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => localStorage.getItem("pubmaxx:analytics-consent:v1")))
          .toBe(allow ? "granted" : "denied");
      }
    });
  }
}
