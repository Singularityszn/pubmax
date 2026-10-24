import { expect, test, type Locator, type Page } from "@playwright/test";

import { answerFirstRunQuestions } from "./helpers/firstRunJourney";
import { installNativeShell } from "./helpers/nativeShell";

async function expectReachable(page: Page, action: Locator): Promise<void> {
  await expect(action).toBeInViewport({ ratio: 1 });
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  const hit = await action.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { owned: button.contains(target), button: button.textContent, target: target?.outerHTML.slice(0, 300) };
  });
  expect(hit.owned, JSON.stringify(hit)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`clean onboarding actions stay reachable at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await installNativeShell(page);
      await page.goto("/");
      await expect(page).toHaveURL(/\/onboarding$/);
      await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
      await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);

      const london = page.getByRole("button", { name: "Use London" });
      expect(await page.locator(".firstRunStage").evaluate((surface) => surface.scrollTop)).toBe(0);
      await testInfo.attach("london-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("london-browser-initial.png") }), contentType: "image/png" });
      await expectReachable(page, london);
      await page.locator(".firstRunStage").evaluate((surface) => {
        surface.scrollTo(0, surface.scrollHeight);
      });
      const lastArea = page.locator(".firstRunAreaList article").last();
      await expect(lastArea).toBeInViewport({ ratio: 1 });
      const areaBox = await lastArea.boundingBox();
      const actionBox = await london.boundingBox();
      expect(areaBox!.y + areaBox!.height).toBeLessThanOrEqual(actionBox!.y);
      await expectReachable(page, london);
      await answerFirstRunQuestions(page);

      const plan = page.getByRole("button", { name: "Plan my night" });
      expect(await page.locator(".firstRunStage").evaluate((surface) => surface.scrollTop)).toBe(0);
      await testInfo.attach("companion-browser-initial", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser-initial.png") }), contentType: "image/png" });
      await expectReachable(page, plan);
      await page.getByRole("button", { name: /Black Cat/ }).click();
      await expectReachable(page, plan);
      await testInfo.attach("companion-browser", { body: await page.screenshot({ path: testInfo.outputPath("companion-browser.png") }), contentType: "image/png" });

      const buttons = page.locator(".firstRunOnboarding button");
      await page.getByRole("button", { name: "Skip", exact: true }).focus();
      for (let index = 1; index < await buttons.count(); index += 1) {
        await page.keyboard.press("Tab");
        await expect(buttons.nth(index)).toBeFocused();
        await expectReachable(page, buttons.nth(index));
      }
      await page.locator(".firstRunStage").evaluate((surface) => {
        surface.scrollTo(0, surface.scrollHeight);
      });
      await expect(page.locator(".firstRunPermissionNote")).toBeInViewport({ ratio: 1 });
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expectReachable(page, page.getByRole("button", { name: "That looks right" }));
    });
  }

  test(`onboarding actions survive consent dismissal at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await installNativeShell(page);
    await page.addInitScript(() => {
      // Seed the answer only for consent geometry, as ux-consent-chrome.spec.ts does.
      localStorage.removeItem("pubmaxx:analytics-consent:v1");
      sessionStorage.setItem("pubmax:consent-answer-moment:v1", "venue-sheet");
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    const consent = page.getByLabel("Anonymous analytics choice");
    await expect(consent).toBeVisible();
    const london = page.getByRole("button", { name: "Use London" });
    expect(await page.locator(".firstRunStage").evaluate((surface) => surface.scrollTop)).toBe(0);
    await expectReachable(page, london);
    await answerFirstRunQuestions(page);
    const plan = page.getByRole("button", { name: "Plan my night" });
    await expectReachable(page, plan);
    await consent.getByRole("button", { name: "No thanks" }).click();
    await expect(consent).toBeHidden();
    await expectReachable(page, plan);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expectReachable(page, page.getByRole("button", { name: "That looks right" }));
  });
}
