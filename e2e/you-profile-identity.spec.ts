import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

import { ACCOUNTS, installAuthDoubles, readDeviceAccounts, readDeviceIdentity, seedSignedIn, type AccountKey } from "./helpers/authDoubles";
import { storeThemeChoice } from "./helpers/themeClock";

const PHOTO = `/api/avatar/${ACCOUNTS.A.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const PROVIDER_PHOTO = `/api/avatar/${ACCOUNTS.A.id}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;

async function installProfileCards(page: Page) {
  const stub = await installAuthDoubles(page, { providerAvatars: { A: PROVIDER_PHOTO, B: PHOTO } });
  for (const [path, background] of [[PHOTO, "coral"], [PROVIDER_PHOTO, "royalblue"]] as const) {
    const image = await sharp({ create: { width: 80, height: 80, channels: 3, background } }).png().toBuffer();
    await page.route((url) => url.pathname === path, (route) => route.fulfill({ contentType: "image/png", body: image }));
  }
  let holdSecondary = false;
  let heldRequests = 0;
  let completedHeldRequests = 0;
  const updatedSecondaryName = "Karan Updated M";
  let releaseSecondary = () => {};
  const secondaryRead = new Promise<void>((resolve) => { releaseSecondary = resolve; });
  await page.route((url) => /^\/api\/profiles\/(karan|karansznx)$/.test(url.pathname), async (route) => {
    const primary = new URL(route.request().url()).pathname.endsWith("/karan");
    const account = primary ? ACCOUNTS.A : ACCOUNTS.B;
    const delayed = !primary && holdSecondary;
    if (delayed) {
      heldRequests += 1;
      await secondaryRead;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({
      profile: { id: account.id, handle: account.handle, displayName: delayed ? updatedSecondaryName : account.name,
        ...(primary ? { avatarUrl: PHOTO } : {}),
        bio: "Good pubs. Better company.", favouriteDrink: "Whisky", homeCity: "London",
        createdAt: "2026-08-01T12:00:00.000Z", updatedAt: "2026-08-01T12:00:00.000Z" },
      counts: { followers: 4, following: 3 }, socialLinks: [],
    }) });
    if (delayed) completedHeldRequests += 1;
  });
  return {
    stub,
    updatedSecondaryName,
    heldProfileState: () => ({ requested: heldRequests, completed: completedHeldRequests }),
    holdProfile: () => { holdSecondary = true; },
    releaseProfile: () => releaseSecondary(),
  };
}

for (const mode of [
  { name: "desktop", viewport: { width: 1440, height: 1000 }, touch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, touch: true },
] as const) {
  test.describe(mode.name, () => {
    test.use({ viewport: mode.viewport, hasTouch: mode.touch, isMobile: mode.touch });

    test("an account without a profile photo never borrows the provider picture", async ({ page }) => {
      test.setTimeout(60_000);
      await storeThemeChoice(page, "light");
      const browserTime = Date.now();
      await page.clock.setFixedTime(browserTime);
      const { stub, holdProfile, releaseProfile, heldProfileState, updatedSecondaryName } = await installProfileCards(page);
      await seedSignedIn(page, "A");
      await page.goto("/login");
      const loginCard = page.getByRole("region", { name: "Signed-in account" });
      await expect(loginCard.locator(".loginPageWho")).toHaveText(ACCOUNTS.A.name);
      await expect(loginCard.locator(".loginPageHandle")).toHaveText(`@${ACCOUNTS.A.handle}`);
      await expect(loginCard.locator(".loginPageIdentity img")).toHaveAttribute("src", new RegExp(PHOTO));

      await page.goto(`/u/${ACCOUNTS.A.handle}`);
      const nav = page.locator(".siteNavBar");
      const trigger = nav.getByRole("button", { name: /^Account options for / });
      const menu = page.locator(".authAccountMenu");
      const list = menu.locator(".authSwitcherList");
      const activate = (control: Locator) => mode.touch ? control.tap() : control.click();
      const openMenu = async () => {
        await expect(async () => {
          if (!(await menu.isVisible())) await activate(trigger);
          await expect(menu).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 20_000 });
      };
      const targetAccount = async (key: AccountKey) => {
        if (!(await list.isVisible())) {
          await activate(menu.getByRole("button", { name: "Switch account", exact: true }));
        }
        return list.locator(".authSwitcherRow").filter({
          has: page.getByText(`@${ACCOUNTS[key].handle}`, { exact: true }),
        });
      };
      const expectSecondaryAvatar = async (name: string) => {
        await expect(trigger).toHaveAttribute("aria-label", `Account options for ${name}`);
        await expect(trigger.locator("img")).toHaveCount(0);
        await expect(trigger.locator(".authAvatarFallback")).toHaveText("KM");
        await openMenu();
        await expect(menu.locator(".authAccountName")).toHaveText(name);
        await expect(menu.locator(".authAccountHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
        await expect(menu.locator(".authAccountCard img")).toHaveCount(0);
        await expect(menu.locator(".authAccountAvatarFallback")).toHaveText("KM");
      };

      await expect(page.locator(".profileAvatar")).toHaveAttribute("src", new RegExp(PHOTO));
      await expect(trigger).toHaveAttribute("aria-label", `Account options for ${ACCOUNTS.A.name}`);
      await expect(trigger.locator("img")).toHaveAttribute("src", new RegExp(PHOTO));

      await stub.signedInAs("B");
      await page.goto(`/u/${ACCOUNTS.B.handle}`);
      await expect(page.locator(".profileHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
      await expect(page.locator(".profileAvatarFallback")).toHaveText("K");
      await expectSecondaryAvatar(ACCOUNTS.B.name);
      const mountedUrl = page.url();
      await page.locator("html").evaluate((root) => root.setAttribute("data-you-switch-document", "mounted"));
      const expectSameDocument = async () => {
        await expect(page).toHaveURL(mountedUrl);
        await expect(page.locator("html")).toHaveAttribute("data-you-switch-document", "mounted");
      };

      await activate(await targetAccount("A"));
      await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
      await expect(trigger).toHaveAttribute("aria-label", `Account options for ${ACCOUNTS.A.name}`);
      await expect(trigger.locator("img")).toHaveAttribute("src", new RegExp(PHOTO));
      await openMenu();
      await expect(menu.locator(".authAccountName")).toHaveText(ACCOUNTS.A.name);
      await expect(menu.locator(".authAccountHandle")).toHaveText(`@${ACCOUNTS.A.handle}`);
      await expect(menu.locator(".authAccountCard img")).toHaveAttribute("src", new RegExp(PHOTO));
      await expectSameDocument();

      const secondary = await targetAccount("B");
      await expect(secondary.locator(".authSwitcherName")).toHaveText(ACCOUNTS.B.name);
      await expect(secondary.locator("img")).toHaveCount(0);
      // Expire the prefetched public card. The pending read must not preserve A's photo.
      await page.clock.setFixedTime(browserTime + 61_000);
      holdProfile();
      try {
        await activate(secondary);
        await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
        await expectSecondaryAvatar(ACCOUNTS.B.name);
        await expect.poll(() => heldProfileState().requested).toBeGreaterThan(0);
        expect(heldProfileState().completed).toBe(0);
        await expectSameDocument();

        const receivedProfile = page.waitForResponse(async (response) => {
          if (new URL(response.url()).pathname !== `/api/profiles/${ACCOUNTS.B.handle}` || response.status() !== 200) return false;
          const body = await response.json() as { profile?: { displayName?: string } };
          return body.profile?.displayName === updatedSecondaryName;
        });
        releaseProfile();
        const response = await receivedProfile;
        expect(await response.finished()).toBeNull();
        expect(await response.json()).toMatchObject({ profile: {
          id: ACCOUNTS.B.id, handle: ACCOUNTS.B.handle, displayName: updatedSecondaryName,
        } });
        await expect.poll(() => heldProfileState().completed).toBeGreaterThan(0);
        await expectSecondaryAvatar(updatedSecondaryName);
        await expect(page.locator(".profileHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
        await expectSameDocument();
      } finally {
        releaseProfile();
      }

      await page.goto("/login");
      await expect(loginCard.locator(".loginPageIdentity img")).toHaveCount(0);
      await expect(loginCard.locator(".loginPageWho")).toHaveText(updatedSecondaryName);
      await expect(loginCard.locator(".loginPageHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
      await expect(loginCard.locator(".loginPageIdentity .authAvatarFallback")).toHaveText("KM");

      if (mode.touch) {
        // Signing out only B would activate the remembered A session.
        await loginCard.getByRole("button", { name: "Sign out of all accounts", exact: true }).tap();
        await expect.poll(async () => (await readDeviceAccounts(page)).length).toBe(0);
        await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBeNull();
        await expect(loginCard).toHaveCount(0);

        const you = page.getByRole("navigation", { name: "Primary", exact: true })
          .getByRole("link", { name: "You", exact: true });
        await expect(you).toHaveAttribute("href", "/u/you");
        await expect(async () => {
          await you.tap();
          await expect(page.getByRole("heading", { name: "Claim your @handle.", exact: true }))
            .toBeVisible({ timeout: 1_000 });
        }).toPass({ timeout: 20_000 });
        await expect(page).toHaveURL(/\/u\/you$/);
        await expect(page.locator(".profileHandle, .profileDisplayName, .profileAvatar, .siteNavBar img.authAvatar"))
          .toHaveCount(0);
        await expect(page.getByRole("link", { name: "Sign in to follow", exact: true })).toHaveCount(0);
      }
    });
  });
}

for (const view of [
  { width: 1440, height: 1000, theme: "light" },
  { width: 1440, height: 1000, theme: "dark" },
  { width: 390, height: 844, theme: "light" },
  { width: 390, height: 844, theme: "dark" },
  { width: 641, height: 1100, theme: "light" },
  { width: 641, height: 1100, theme: "dark" },
  { width: 768, height: 1100, theme: "light" },
  { width: 768, height: 1100, theme: "dark" },
  { width: 900, height: 1100, theme: "light" },
  { width: 900, height: 1100, theme: "dark" },
  { width: 320, height: 720, theme: "light" },
] as const) {
  test(`profile sections and activity fit ${view.width}px in ${view.theme}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: view.width, height: view.height });
    await installProfileCards(page);
    await storeThemeChoice(page, view.theme);
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
    await expect(page.locator("#account-settings")).toBeVisible();
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
        nameClientWidth: document.querySelector<HTMLElement>(".profileDisplayName")!.clientWidth,
        nameScrollWidth: document.querySelector<HTMLElement>(".profileDisplayName")!.scrollWidth,
        actionTargets: [...document.querySelectorAll<HTMLElement>(".profileActions a, .profileActions button")].map((control) => {
          const box = control.getBoundingClientRect();
          return { text: control.textContent?.trim(), left: box.left, top: box.top, width: box.width, height: box.height,
            clientWidth: control.clientWidth, scrollWidth: control.scrollWidth, clientHeight: control.clientHeight, scrollHeight: control.scrollHeight };
        }),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
      };
    });
    await testInfo.attach("profile-geometry", { body: JSON.stringify({ view, geometry }), contentType: "application/json" });
    expect(geometry.overflow).toBe(false);
    expect(geometry.nameScrollWidth).toBeLessThanOrEqual(geometry.nameClientWidth + 1);
    expect(geometry.actionTargets.length).toBeGreaterThan(0);
    for (const action of geometry.actionTargets) {
      expect(action.width, action.text).toBeGreaterThanOrEqual(44);
      expect(action.height, action.text).toBeGreaterThanOrEqual(44);
      expect(action.scrollWidth, action.text).toBeLessThanOrEqual(action.clientWidth + 1);
      expect(action.scrollHeight, action.text).toBeLessThanOrEqual(action.clientHeight + 1);
    }
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
    const screenshot = testInfo.outputPath(`you-${view.width}-${view.theme}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach("you-profile", { path: screenshot, contentType: "image/png" });
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
