import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

import { ACCOUNTS, installAuthDoubles, readDeviceIdentity, seedSignedIn } from "./helpers/authDoubles";

const PHOTO = `/api/avatar/${ACCOUNTS.A.id}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

async function installProfileCards(page: Page) {
  const stub = await installAuthDoubles(page, { providerAvatars: { A: PHOTO, B: PHOTO } });
  const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: "coral" } }).png().toBuffer();
  await page.route((url) => url.pathname === PHOTO, (route) => route.fulfill({ contentType: "image/png", body: image }));
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

test("an account without a profile photo never borrows the provider picture", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const browserTime = Date.now();
  await page.clock.setFixedTime(browserTime);
  const { stub, holdProfile, releaseProfile, heldProfileState, updatedSecondaryName } = await installProfileCards(page);
  await seedSignedIn(page, "A");
  await page.goto(`/u/${ACCOUNTS.A.handle}`);
  await expect(page.locator(".profileAvatar")).toHaveAttribute("src", new RegExp(PHOTO));
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveAttribute("src", new RegExp(PHOTO));
  await expect(page.getByRole("button", { name: `Account options for ${ACCOUNTS.A.name}`, exact: true })).toBeVisible();

  await stub.signedInAs("B");
  await page.goto(`/u/${ACCOUNTS.B.handle}`);
  await expect(page.locator(".profileHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".profileAvatarFallback")).toHaveText("K");
  await expect(page.locator(".siteNavBar .authAvatarFallback")).toHaveText("KM");
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  const trigger = page.getByRole("button", { name: /Account options/ }).first();
  await expect(async () => {
    if (!(await page.locator(".authAccountMenu").isVisible())) await trigger.click();
    await expect(page.locator(".authAccountMenu")).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(trigger).toHaveAttribute("aria-label", `Account options for ${ACCOUNTS.B.name}`);
  await expect(page.locator(".authAccountName")).toHaveText(ACCOUNTS.B.name);
  await expect(page.locator(".authAccountHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".authAccountAvatarFallback")).toHaveText("KM");
  await page.getByRole("button", { name: "Switch account", exact: true }).click();
  await page.locator(".authSwitcherList .authSwitcherRow").click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.A.handle);
  await expect(page.locator(".siteNavBar img.authAvatar").first()).toHaveAttribute("src", new RegExp(PHOTO));
  await expect(trigger).toHaveAttribute("aria-label", `Account options for ${ACCOUNTS.A.name}`);
  // The switch uses the live session event in the mounted page. No navigation
  // or reload is permitted between these two account transitions.
  if (!(await page.locator(".authAccountMenu").isVisible())) await trigger.click();
  await expect(page.locator(".authAccountName")).toHaveText(ACCOUNTS.A.name);
  await expect(page.locator(".authAccountHandle")).toHaveText(`@${ACCOUNTS.A.handle}`);
  await expect(page.locator(".authAccountCard img")).toHaveAttribute("src", new RegExp(PHOTO));
  if (!(await page.locator(".authSwitcherList").isVisible())) {
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
  }
  await expect(page.locator(".authSwitcherList .authSwitcherName")).toHaveText(ACCOUNTS.B.name);
  // Exercise a network read after the cached public card expires, without a real-time wait.
  await page.clock.setFixedTime(browserTime + 61_000);
  holdProfile();
  await page.locator(".authSwitcherList .authSwitcherRow").click();
  await expect.poll(async () => (await readDeviceIdentity(page)).handle).toBe(ACCOUNTS.B.handle);
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-label", `Account options for ${ACCOUNTS.B.name}`);
  await expect(page.locator(".siteNavBar .authAvatarFallback")).toHaveText("KM");
  await expect.poll(() => heldProfileState().requested).toBeGreaterThan(0);
  expect(heldProfileState().completed).toBe(0);
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
  await expect(trigger).toHaveAttribute("aria-label", `Account options for ${updatedSecondaryName}`);
  await expect(page.locator(".profileHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".siteNavBar img.authAvatar")).toHaveCount(0);
  await expect(page.locator(".siteNavBar .authAvatarFallback")).toHaveText("KM");
  if (!(await page.locator(".authAccountMenu").isVisible())) await trigger.click();
  await expect(page.locator(".authAccountName")).toHaveText(updatedSecondaryName);
  await expect(page.locator(".authAccountHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".authAccountAvatarFallback")).toHaveText("KM");
  await page.goto("/login");
  await expect(page.getByRole("region", { name: "Signed-in account" })).toBeVisible();
  await expect(page.locator(".loginPageIdentity img")).toHaveCount(0);
  await expect(page.locator(".loginPageWho")).toHaveText(updatedSecondaryName);
  await expect(page.locator(".loginPageHandle")).toHaveText(`@${ACCOUNTS.B.handle}`);
  await expect(page.locator(".loginPageIdentity .authAvatarFallback")).toHaveText("KM");
});

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
