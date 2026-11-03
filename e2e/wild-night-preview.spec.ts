import { expect, test, type Page } from "@playwright/test";
import { storeThemeChoice } from "./helpers/themeClock";

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

for (const theme of ["light", "dark"] as const) {
  test(`phone picker follows the header in ${theme} with enlarged text`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await storeThemeChoice(page, theme);
    await page.goto("/today?wild=1");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.addStyleTag({ content: "html { font-size: 150% !important; }" });
    expect(await page.locator("html").evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(24);
    const select = picker(page);
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveText(["Previews off", "Round Rota", "Borough Bingo"]);
    const nav = page.getByRole("navigation", { name: "Site navigation" });
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
    expect(await wrapper.evaluate((element) => getComputedStyle(element).position)).toBe("static");
    await select.focus();
    await expect(select).toBeFocused();
    await select.selectOption("borough-bingo");
    await expect(select).toHaveValue("borough-bingo");
  });
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
