import { expect, test, type Page } from "@playwright/test";
import { storeThemeChoice } from "./helpers/themeClock";
import { expectMobileMapShellReady, mobileMapShellControl } from "./helpers/mobileMapShell";

const picker = (page: Page) => page.getByLabel("Night preview");

async function openMore(page: Page) {
  const trigger = page.getByRole("button", { name: "More pages" });
  await expect(trigger).toBeEnabled();
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  return menu;
}

async function openPreviewMenu(page: Page) {
  const trigger = page.getByRole("button", { name: "More pages" });
  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(async () => {
    await expect(trigger).toBeEnabled();
    if (await trigger.getAttribute("aria-expanded") !== "true") {
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
    }
    await expect(menu.getByRole("menuitem", { name: /^Round Rota/ })).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  return menu;
}

test("the master switch hides the picker on phone and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=0&wildpreview=borough-bingo");
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(picker(page)).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const menu = await openMore(page);
  await expect(menu.getByRole("menuitem", { name: /^Round Rota/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Borough Bingo/ })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Previews off/ })).toHaveCount(0);
});

test("a selected preview link preserves the other query, hash and history", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?source=before");
  await page.goto("/today?wild=1&keep=a%20b&wildpreview=round-rota&keep=two#details");
  await expect(picker(page)).toHaveValue("round-rota");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=a%20b&keep=two");
  expect(new URL(page.url()).hash).toBe("#details");
  await page.goBack();
  await expect.poll(() => new URL(page.url()).search).toBe("?source=before");
  await page.goForward();
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=a%20b&keep=two");
  expect(new URL(page.url()).hash).toBe("#details");
  await expect(picker(page)).toHaveValue("round-rota");
});

test("an old Tarot link is scrubbed and leaves previews off", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1&wildpreview=pub-tarot&keep=1#details");
  await expect(picker(page)).toHaveValue("off");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=1");
  expect(new URL(page.url()).hash).toBe("#details");
});

for (const host of [
  { name: "SiteNav", path: "/today", header: ".siteNavBar", map: false },
  { name: "Home", path: "/", header: ".lpNav", map: false },
  { name: "Plan", path: "/plan", header: ".siteNavBar", map: false },
  { name: "Map", path: "/map", header: ".mobileMapTopbar", map: true },
  { name: "town Map", path: "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213", header: ".mobileMapTopbar", map: true },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`${host.name} phone picker follows the header in ${theme} with enlarged text`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width: 390, height: 844 });
      await storeThemeChoice(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript(() => {
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax_onboarding_dismissed", "1");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      });
      await page.goto(`${host.path}${host.path.includes("?") ? "&" : "?"}wild=1`);
      if (host.map) await expectMobileMapShellReady(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const select = picker(page);
      await expect(select).toHaveCount(1);
      await expect(select).toBeVisible();
      // Wait for the client picker and applied text size before measuring layout.
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await expect.poll(() => page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(32);
      await page.evaluate(() => document.fonts.ready);
      await expect(select).toHaveValue("off");
      await expect(select.locator("option")).toHaveText(["Previews off", "Round Rota", "Borough Bingo"]);
      const nav = page.locator(host.header);
      const navBox = await nav.boundingBox();
      const selectBox = await select.boundingBox();
      const wrapper = page.locator(".wildNightPreviewMobile");
      const wrapperBox = await wrapper.boundingBox();
      expect(navBox).not.toBeNull();
      expect(selectBox).not.toBeNull();
      expect(wrapperBox).not.toBeNull();
      expect(wrapperBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height - 1);
      expect(selectBox!.x).toBeGreaterThanOrEqual(0);
      expect(selectBox!.x + selectBox!.width).toBeLessThanOrEqual(390);
      expect(await select.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      })).toBe(true);
      expect(await wrapper.evaluate((element) => getComputedStyle(element).position)).toBe("static");
      expect(await wrapper.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (["fixed", "absolute"].includes(getComputedStyle(parent).position) && parent.classList.contains("mobileMapChrome")) return false;
        }
        return true;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await select.focus();
      await expect(select).toBeFocused();
      await page.keyboard.press("Space");
      await page.keyboard.press("b");
      await page.keyboard.press("Enter");
      await expect(select).toHaveValue("borough-bingo");
      await page.screenshot({ path: testInfo.outputPath("phone-picker-200.png") });

      if (host.map) {
        const chrome = page.locator(".mobileMapChrome");
        const canvas = page.locator(".mapStage > .mapCanvasWrap");
        await expect.poll(async () => {
          const chromeBox = await chrome.boundingBox();
          const canvasBox = await canvas.boundingBox();
          return Boolean(chromeBox && canvasBox && canvasBox.y >= chromeBox.y + chromeBox.height && canvasBox.height > 0);
        }).toBe(true);
        const canvasBox = await canvas.boundingBox();
        expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(845);
        const search = await mobileMapShellControl(page, "search");
        expect(await search.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
        await search.focus();
        await page.keyboard.press("Enter");
        await expect(search).toHaveAttribute("aria-expanded", "true");
        await expect(select).toHaveValue("borough-bingo");
        await search.focus();
        await page.keyboard.press("Enter");
        await expect(search).toHaveAttribute("aria-expanded", "false");
      }

      await select.evaluate((element) => { element.dataset.navigationProof = "mounted"; });
      await page.evaluate(() => {
        const address = new URL(window.location.href);
        address.searchParams.set("wildpreview", "off");
        window.history.pushState({ retained: true }, "", `${address.pathname}${address.search}#details`);
      });
      await expect(select).toHaveValue("off");
      await expect(select).toHaveAttribute("data-navigation-proof", "mounted");
      await expect.poll(() => new URL(page.url()).searchParams.has("wildpreview")).toBe(false);
      expect(new URL(page.url()).hash).toBe("#details");
      expect(await page.evaluate(() => window.history.state.retained)).toBe(true);
      await page.evaluate(() => {
        const address = new URL(window.location.href);
        address.searchParams.set("wild", "0");
        window.history.pushState(null, "", `${address.pathname}${address.search}`);
      });
      await expect(select).toHaveCount(0);
    });
  }
}

test("desktop choices stay in More and work with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/today?wild=1");
  await expect(picker(page)).toBeHidden();
  const menu = await openPreviewMenu(page);
  const labels = await menu.locator(".siteNavMoreLabel").allTextContents();
  expect(labels.slice(-3)).toEqual(["Previews off", "Round Rota", "Borough Bingo"]);
  await expect(menu.getByRole("menuitem").filter({ hasText: /Selected on this browser|Select this public preview/ })).toHaveCount(3);
  expect(labels).not.toContain("Pub Tarot");
  await page.keyboard.press("End");
  const bingo = menu.getByRole("menuitem", { name: /^Borough Bingo/ });
  await expect(bingo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveCount(0);
  const reopened = await openPreviewMenu(page);
  await expect(reopened.getByRole("menuitem", { name: /^Borough Bingo/ })).toContainText("Selected on this browser");
});

test("phone native picker opens, selects and commits with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1");
  const select = picker(page);
  await expect(select).toBeVisible();
  await expect(select).toHaveValue("off");
  await select.focus();
  await expect(select).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("b");
  await page.keyboard.press("Enter");
  await expect(select).toHaveValue("borough-bingo");
});

test("two tabs receive real storage changes from the other tab", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1");
  await expect(picker(page)).toBeVisible();
  const other = await context.newPage();
  await other.setViewportSize({ width: 390, height: 844 });
  await other.goto("/today");
  await expect(picker(other)).toBeVisible();

  await picker(page).selectOption("round-rota");
  await expect(picker(other)).toHaveValue("round-rota");
  await picker(other).selectOption("borough-bingo");
  await expect(picker(page)).toHaveValue("borough-bingo");
  await picker(page).selectOption("off");
  await expect(picker(other)).toHaveValue("off");

  await page.goto("/today?wild=0");
  await expect(picker(page)).toHaveCount(0);
  await expect(picker(other)).toHaveCount(0);
  await other.goto("/today?wild=1");
  await expect(picker(other)).toBeVisible();
  await expect(picker(page)).toBeVisible();
  await other.close();
});

test("a query-only off link updates the mounted picker", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today?wild=1&wildpreview=borough-bingo");
  const select = picker(page);
  await expect(select).toHaveValue("borough-bingo");
  await select.evaluate((element) => { element.dataset.navigationProof = "mounted"; });
  await page.evaluate(() => window.history.pushState({ kept: true }, "", "/today?keep=1&wildpreview=off#details"));
  await expect(select).toHaveValue("off");
  await expect(select).toHaveAttribute("data-navigation-proof", "mounted");
  await expect.poll(() => new URL(page.url()).search).toBe("?keep=1");
  expect(new URL(page.url()).hash).toBe("#details");
  expect(await page.evaluate(() => window.history.state.kept)).toBe(true);
});
