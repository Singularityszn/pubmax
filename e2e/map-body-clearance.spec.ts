import { expect, test, type Page } from "@playwright/test";

test.setTimeout(90_000);

async function returningVisitor(page: Page, consent = false): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((showConsent) => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    if (showConsent) localStorage.removeItem("pubmaxx:analytics-consent:v1");
    else localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
    sessionStorage.removeItem("pubmax:prompt-budget:v1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, consent);
}

for (const width of [390, 768, 1440]) {
  test(`Manchester map fills ${width}x900 without a blank document tail`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await returningVisitor(page);
    await page.goto("/map/manchester");
    await expect(page.locator(".mapStage")).toBeVisible();
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });

    const dimensions = await page.evaluate(() => ({
      viewport: window.innerHeight,
      document: document.documentElement.scrollHeight,
      bodyPadding: Number.parseFloat(getComputedStyle(document.body).paddingBottom),
      stageBottom: document.querySelector(".mapStage")?.getBoundingClientRect().bottom,
    }));

    expect(dimensions.stageBottom).toBeCloseTo(dimensions.viewport, 0);
    expect(dimensions.bodyPadding).toBe(0);
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}

for (const width of [390, 768, 1440]) {
  for (const consent of [true, false]) {
    test(`Places final city stays clear at ${width}px with consent ${consent ? "present" : "absent"}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await returningVisitor(page, consent);
      await page.goto("/places");
      const prompt = page.getByLabel("Anonymous analytics choice");
      await expect(prompt).toHaveCount(consent ? 1 : 0);
      if (consent) await expect(prompt).toBeVisible();
      const lastCity = page.locator(".placesCityLink").last();
      await expect(lastCity).toBeVisible();
      const obstruction = consent ? prompt : page.locator(".createFabRoot");
      if (consent || width === 390) await expect(obstruction).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const last = await lastCity.boundingBox();
      expect(last).not.toBeNull();
      const ceiling = consent || width === 390
        ? (await obstruction.boundingBox())!.y
        : 900;
      expect(last!.y).toBeGreaterThanOrEqual(0);
      expect(last!.y + last!.height).toBeLessThan(ceiling);
      expect(await lastCity.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      })).toBe(true);
      const destination = await lastCity.getAttribute("href");
      expect(destination).not.toBeNull();
      await lastCity.click();
      await expect(page).toHaveURL(new URL(destination!, page.url()).href);
    });
  }
}

test("a page without Create only reserves its mobile tab bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await returningVisitor(page);
  await page.goto("/places");
  const create = page.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeVisible();
  const createBox = (await create.boundingBox())!;
  const withCreate = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).paddingBottom));
  await page.goto("/pal");
  await expect(page.locator(".createFabRoot")).toHaveCount(0);
  const bar = page.getByRole("navigation", { name: "Primary" });
  await expect(bar).toBeVisible();
  const barBox = await bar.boundingBox();
  expect(barBox).not.toBeNull();
  const withoutCreate = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).paddingBottom));
  expect(withoutCreate).toBeGreaterThanOrEqual(barBox!.height);
  expect(withCreate - withoutCreate).toBeGreaterThanOrEqual(createBox.height);
});
