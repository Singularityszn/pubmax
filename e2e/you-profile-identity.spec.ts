import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";

const PHOTO = `/api/avatar/${ACCOUNTS.A.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

async function installProfileCards(page: Page) {
  const stub = await installAuthDoubles(page, { providerAvatars: { A: PHOTO, B: PHOTO } });
  const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: "coral" } }).png().toBuffer();
  await page.route((url) => url.pathname === PHOTO, (route) => route.fulfill({ contentType: "image/png", body: image }));
  let holdSecondary = false;
  let releaseSecondary = () => {};
  const secondaryRead = new Promise<void>((resolve) => { releaseSecondary = resolve; });
  await page.route((url) => /^\/api\/profiles\/(karan|karansznx)$/.test(url.pathname), async (route) => {
    const primary = new URL(route.request().url()).pathname.endsWith("/karan");
    const account = primary ? ACCOUNTS.A : ACCOUNTS.B;
    if (!primary && holdSecondary) await secondaryRead;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      profile: { id: account.id, handle: account.handle, displayName: account.name,
        ...(primary ? { avatarUrl: PHOTO } : {}),
        bio: "Good pubs. Better company.", favouriteDrink: "Whisky", homeCity: "London",
        createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
      counts: { followers: 4, following: 3 }, socialLinks: [],
    }) });
  });
  return {
    stub,
    holdProfile: () => { holdSecondary = true; },
    releaseProfile: () => releaseSecondary(),
  };
}

test("an account without a profile photo never borrows the provider picture", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { stub, holdProfile, releaseProfile } = await installProfileCards(page);
  await seedSignedIn(page, "A");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect(page.locator(".profileAvatar")).toHaveAttribute("src", new RegExp(PHOTO));
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveAttribute("src", new RegExp(PHOTO));

  await stub.signedInAs("B");
  await page.goto(`/u/${ACCOUNTS.B.handle}`);
  await expect(page.locator(".profileHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".profileAvatarFallback")).toBeVisible();
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: /Account options/ }).first();
  await expect(async () => {
    if (!(await page.locator(".authAccountMenu").isVisible())) await trigger.click();
    await expect(page.locator(".authAccountMenu")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Switch account", exact: true }).click();
  await page.locator(".authSwitcherList .authSwitcherRow").click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(page.locator(".siteNavBar img.authAvatar").first()).toHaveAttribute("src", new RegExp(PHOTO));
  // The switch uses the live session event in the mounted page. No navigation
  // or reload is permitted between these two account transitions.
  if (!(await page.locator(".authAccountMenu").isVisible())) await trigger.click();
  if (!(await page.locator(".authSwitcherList").isVisible())) {
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
  }
  holdProfile();
  await page.locator(".authSwitcherList .authSwitcherRow").click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  releaseProfile();
  await expect(page.locator(".profileDisplayName")).toHaveText(ACCOUNTS.B.name);
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  await page.goto("/login");
  await expect(page.getByRole("region", { name: "Signed-in account" })).toBeVisible();
  await expect(page.locator(".loginPageIdentity img")).toHaveCount(0);
});

for (const view of [
  { width: 1440, height: 1000, theme: "light" },
  { width: 1440, height: 1000, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
  { width: 320, height: 720, theme: "light" },
] as const) {
  test(`profile sections and activity fit ${view.width}px in ${view.theme}`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: view.width, height: view.height });
    await installProfileCards(page);
    await page.addInitScript((theme) => localStorage.setItem("pubmax-theme", theme), view.theme);
    await seedSignedIn(page, "B");
    await page.goto(`/u/${ACCOUNTS.B.handle}`);
    await expect(page.locator(".profileDisplayName")).toHaveText(ACCOUNTS.B.name);
    await expect(page.locator("html")).toHaveAttribute("data-theme", view.theme);
    const nav = page.getByRole("navigation", { name: "Your profile sections" });
    await expect(nav).toBeVisible();
    for (const link of await nav.getByRole("link").all()) {
      const box = await link.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator("#timeline")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector(selector)!.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      };
      return {
        nav: rect(".youProfileTabs"), journal: rect(".profileJournal"),
        sidebar: rect(".profileSidebar"), settings: rect("#account-settings"),
        cover: rect(".profileCover"), name: rect(".profileNames"),
        actions: rect(".profileActions"), avatar: rect(".profileAvatar"),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.nav.bottom).toBeLessThanOrEqual(geometry.journal.top);
    expect(geometry.settings.top).toBeGreaterThanOrEqual(geometry.sidebar.bottom);
    expect(geometry.settings.top).toBeGreaterThanOrEqual(geometry.journal.bottom);
    if (view.width >= 1024) expect(geometry.sidebar.right).toBeLessThan(geometry.journal.left);
    else expect(geometry.journal.bottom).toBeLessThanOrEqual(geometry.sidebar.top);
    if (view.width > 640) {
      expect(geometry.name.top).toBeGreaterThanOrEqual(geometry.cover.bottom);
      expect(geometry.actions.top).toBeGreaterThanOrEqual(geometry.cover.bottom);
      expect(geometry.avatar.top).toBeLessThan(geometry.cover.bottom);
    }
    await page.screenshot({ path: `artifacts/you-profile/after-${view.width}-${view.theme}.png` });
    await nav.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Saved", exact: true })).toHaveAttribute("aria-current", "location");
    await expect(nav.getByRole("link", { name: "Moments", exact: true })).not.toHaveAttribute("aria-current");
    await expect(page.locator("#saved-pubs")).toBeInViewport();
    await page.goBack();
    await expect(nav.getByRole("link", { name: "Moments", exact: true })).toHaveAttribute("aria-current", "location");
    await page.getByRole("button", { name: "Edit profile", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editing your profile" })).toBeVisible();
  });
}
