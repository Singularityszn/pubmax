import { expect, test } from "@playwright/test";

import { NATIVE_PUSH_PROMPT_COPY } from "@/lib/nativePushPrompt";

import { answerFirstRunQuestions } from "@/e2e/helpers/firstRunJourney";
import {
  installSuccessfulPlanRoute,
  isMarkedDocument,
  markDocument,
  pinLondonEvening,
} from "@/e2e/helpers/nativePushJourney";
import { installNativeShell } from "@/e2e/helpers/nativeShell";
import { expectStreamedPageSettled } from "@/e2e/helpers/streamedPage";

for (const theme of ["light", "dark"] as const) {
  for (const finish of ["Plan my night", "Skip"] as const) {
    test(`native push ask survives planning navigation after ${finish} in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000);
      await pinLondonEvening(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await installNativeShell(page);
      await installSuccessfulPlanRoute(page);
      await page.addInitScript((initialTheme) => {
        window.localStorage.setItem("pubmax-theme", initialTheme);
      }, theme);
      await page.goto("/about");
      await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem(
        "pubmax:entryDecision:consumed:v1",
      ))).toBe("1");
      await page.evaluate(() => {
        window.localStorage.removeItem("pubmax:map-first-visit-arrival:v1");
        window.sessionStorage.clear();
      });

      await page.goto("/");
      await expect(page).toHaveURL(/\/onboarding$/);
      const ask = page.getByRole("dialog", { name: NATIVE_PUSH_PROMPT_COPY.title });
      await expect(ask).toHaveCount(0);
      if (finish === "Plan my night") {
        await answerFirstRunQuestions(page);
        await page.getByRole("button", { name: /Pigeon/ }).click();
      }
      await page.getByRole("button", { name: finish, exact: true }).click();
      if (finish === "Skip") {
        await expect(page).toHaveURL(/\/tonight$/);
        await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("pubmax:prompt-budget:v1"))).toBeNull();
        await page.goto("/map?plan=1");
        await expect(page.getByRole("heading", { name: "Plan a pub crawl" })).toBeVisible();
        await expect(ask).toHaveCount(0);
        await page.getByRole("button", { name: "Make a plan", exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax:nativePush:actionSeq:v1"))).toBe("1");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Edit active 3-stop plan" })).toBeVisible();
      } else {
        await expect(page).toHaveURL(/\/plan\?[^#]*from=onboarding/);
        await expect(page.getByTestId("plan-route-summary")).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, name: /Soho/ })).toBeVisible();
        await expect(ask).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax:nativePush:actionSeq:v1"))).toBe("1");
      }
      await expect(ask).toHaveCount(0);
      const tabs = page.getByRole("navigation", { name: "Primary" });
      await tabs.getByRole("link", { name: "Plan", exact: true }).click();
      await expect(page).toHaveURL(/\/plan$/);
      // The phone composer owns the screen foot, just as the map does.
      await expect(ask).toHaveCount(0);
      await tabs.getByRole("link", { name: "Explore", exact: true }).click();
      await expect(page).toHaveURL(/\/map$/);
      await expect(page.getByRole("complementary", { name: "First visit" })).toBeVisible({ timeout: 30_000 });
      await expect(ask).toHaveCount(0);

      await markDocument(page);
      await tabs.getByRole("link", { name: "Tonight", exact: true }).click();
      await expect(page).toHaveURL(/\/tonight$/);
      expect(await isMarkedDocument(page)).toBe(true);
      await expectStreamedPageSettled(page);
      await expect(ask).toBeVisible();
      await expect(page.getByText(NATIVE_PUSH_PROMPT_COPY.body)).toBeVisible();
      await expect(page.getByRole("complementary", { name: "First visit" })).toHaveCount(0);
      await expect(ask).toBeInViewport({ ratio: 1 });
      for (const name of ["Not now", "Turn on"]) {
        const action = ask.getByRole("button", { name, exact: true });
        const box = await action.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(await action.evaluate((button) => {
          const rect = button.getBoundingClientRect();
          return button.contains(document.elementFromPoint(
            rect.x + rect.width / 2, rect.y + rect.height / 2,
          ));
        })).toBe(true);
      }
      expect(await page.evaluate(() => Math.max(
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth,
      ))).toBeLessThanOrEqual(1);
      const phoneShot = test.info().outputPath("tonight-push-ask.png");
      await page.screenshot({ path: phoneShot });
      await test.info().attach("Tonight push ask", { path: phoneShot, contentType: "image/png" });

      // A new document must not revive the stored useful-action sequence. A
      // completed native first run returns to Home on the next normal launch.
      await page.evaluate(() => window.sessionStorage.clear());
      await page.goto("/");
      await expect(page).toHaveURL(/\/$/);
      await expectStreamedPageSettled(page);
      expect(await isMarkedDocument(page)).toBe(false);
      await expect(ask).toHaveCount(0);
    });
  }
}
