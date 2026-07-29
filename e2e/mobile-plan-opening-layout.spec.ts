import { expect, test, type Page } from "@playwright/test";

const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function prepareBlankPlan(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.localStorage.removeItem("pubmax:nightPatch:v1");
    window.sessionStorage.removeItem("pubmax:plan-draft:v1");
  });
}

for (const viewport of MOBILE_VIEWPORTS) {
  test(`Plan opening screen clears fixed navigation at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await prepareBlankPlan(page);

    const response = await page.goto("/plan");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mobileTabBar")).toBeVisible();

    const heading = page.getByRole("heading", {
      name: "Where should the night happen?",
    });
    const firstChoice = page.getByRole("button", { name: "Use my location" });
    await expect(heading).toBeVisible();
    await expect(firstChoice).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    const [headingBox, firstChoiceBox, navigationBox] = await Promise.all([
      heading.boundingBox(),
      firstChoice.boundingBox(),
      page.locator(".mobileTabBar").boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(firstChoiceBox).not.toBeNull();
    expect(navigationBox).not.toBeNull();
    if (!headingBox || !firstChoiceBox || !navigationBox) return;

    expect(
      headingBox.y + headingBox.height,
      "first Plan heading must end above fixed navigation",
    ).toBeLessThanOrEqual(navigationBox.y);
    expect(
      firstChoiceBox.y + firstChoiceBox.height,
      "first Plan choice must be fully visible above fixed navigation",
    ).toBeLessThanOrEqual(navigationBox.y);
  });
}
