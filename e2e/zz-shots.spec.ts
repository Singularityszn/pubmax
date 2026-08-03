import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const OUT = "/tmp/claude-501/-Users-karanmanoharan--treehouse-pubmax-4f650b-2-pubmax/6b836aad-48be-4d8c-983d-f72ae2d021ef/scratchpad/shots";
test.setTimeout(180_000);

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;

async function shot(page: Page, name: string) {
  await mkdir(OUT, { recursive: true });
  await writeFile(`${OUT}/${name}.png`, await page.screenshot());
}

function nav(page: Page) {
  return { back: page.locator(".surfaceNavBack"), home: page.locator(".surfaceNavHome") };
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`three deep and back ${vp.name} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript((t) => {
        window.localStorage.setItem("pubmax-theme", t);
        window.localStorage.setItem("pubmax-tour-v1-done", "1");
        window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
        window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      await page.goto("/map");
      await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 60_000 });
      await page.waitForTimeout(1200);
      const tag = `${vp.name}-${theme}`;
      await shot(page, `${tag}-0-map`);

      // 1 deep
      await page.getByRole("button", { name: vp.width < 700 ? "More map controls" : "Plan tonight" }).first().click();
      await page.waitForTimeout(700);
      await shot(page, `${tag}-1-first-surface`);

      if (vp.width < 700) {
        // 2 deep: the accessible List view, opened from inside the sheet.
        await page.getByRole("tab", { name: "Layers" }).click();
        await page.locator(".mobileSharedSheetBody").getByRole("button", { name: "List view" }).click();
        await page.waitForTimeout(900);
        await shot(page, `${tag}-2-second-surface`);
        // 3 deep: a pub, opened from the list.
        await page.locator(".mapVenueListItem").first().click();
        await page.waitForTimeout(1500);
        await shot(page, `${tag}-3-third-surface`);
      } else {
        // Desktop: the planner is the left drawer and the venue the right, so
        // the deep stack is List view then a pub over it.
        await page.locator(".surfaceNavHome").first().click();
        await page.waitForTimeout(600);
        await page.getByRole("button", { name: "List view", exact: false }).first().click();
        await page.waitForTimeout(1200);
        await shot(page, `${tag}-2-second-surface`);
        await page.locator(".mapVenueListItem").first().click();
        await page.waitForTimeout(2000);
        await shot(page, `${tag}-3-third-surface`);
      }

      const { back, home } = nav(page);
      const deepBack = await back.first().getAttribute("aria-label");
      console.log(`${tag} :: depth3 back = ${deepBack}`);
      await back.first().click();
      await page.waitForTimeout(1000);
      await shot(page, `${tag}-4-back-to-second`);
      const midBack = await back.first().getAttribute("aria-label").catch(() => null);
      console.log(`${tag} :: depth2 back = ${midBack}`);
      await back.first().click();
      await page.waitForTimeout(1000);
      await shot(page, `${tag}-5-back-to-first`);
      await home.first().click();
      await page.waitForTimeout(1000);
      await shot(page, `${tag}-6-home`);
    });
  }
}
