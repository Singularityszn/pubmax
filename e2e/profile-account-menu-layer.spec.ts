import { expect, test } from "@playwright/test";
import sharp from "sharp";

import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// Rendered pointer access only. Auth and profile/image transport are doubles;
// this does not prove real session revocation or durable authorization.
const PROFILE_ID = ACCOUNTS.A.id;
const COVER_URL = `/api/cover/${PROFILE_ID}/aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

for (const { width, height, theme, withCover } of [
  { width: 1280, height: 720, theme: "dark", withCover: true },
  { width: 1280, height: 900, theme: "light", withCover: false },
  { width: 1440, height: 900, theme: "light", withCover: true },
  { width: 390, height: 844, theme: "dark", withCover: true },
] as const) {
  test(`account menu owns its pointer targets over ${withCover ? "cover" : "no-cover"} profile at ${width}x${height} ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
    await page.addInitScript((value) => {
      localStorage.setItem("pubmax-theme", value);
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax_onboarding_dismissed", "1");
      sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    }, theme);
    const stub = await installAuthDoubles(page);
    stub.setServerHandle(ACCOUNTS.A.handle);
    await seedSignedIn(page, "A");
    await page.route((url) => url.pathname === "/api/profiles/karan", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        profile: {
          id: PROFILE_ID,
          handle: ACCOUNTS.A.handle,
          displayName: "Fixture Karan",
          bio: "A synthetic profile for pointer access checks.",
          coverUrl: withCover ? COVER_URL : null,
          coverUrls: withCover ? [COVER_URL] : [],
          createdAt: "2026-08-01T12:00:00.000Z",
          updatedAt: "2026-08-01T12:00:00.000Z",
        },
        socialLinks: [],
        counts: { followers: 4, following: 6 },
        viewerFollowing: false,
        followsViewer: false,
      }),
    }));
    if (withCover) {
      const image = await sharp({
        create: { width: 1200, height: 400, channels: 3, background: { r: 32, g: 58, b: 84 } },
      }).png().toBuffer();
      await page.route((url) => url.pathname === COVER_URL, (route) => route.fulfill({
        status: 200, contentType: "image/png", body: image,
      }));
    }
    const response = await page.goto("/u/karan");
    expect(response?.status()).toBe(200);
    const header = page.locator("header.profileHeader");
    await expect(header).toBeVisible();
    await expect(header).toContainText("Fixture Karan");
    await expect(header.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
    if (withCover) {
      await expect(page.locator("header.profileHeaderWithCover")).toBeVisible();
      await expect.poll(() => header.locator(".profileCoverImage").first().evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
      )).toBe(true);
    } else {
      await expect(header.locator(".profileCoverImage")).toHaveCount(0);
      await expect(page.locator("header.profileHeaderWithCover")).toHaveCount(0);
    }
    const trigger = page.getByRole("button", { name: /Account options for/ }).first();
    const menu = page.locator(".authAccountMenu");
    await expect(async () => {
      await trigger.click();
      await expect(menu).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    const targets = [];
    for (const name of ["Switch account", "Sign out"]) {
      const button = menu.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      targets.push(await button.evaluate((node, label) => {
        const rect = node.getBoundingClientRect();
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          label,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          inViewport: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
          ownsCenter: hit !== null && node.contains(hit),
          hit: hit ? { tag: hit.tagName, className: hit.getAttribute("class") } : null,
        };
      }, name));
    }
    const actualTheme = await page.locator("html").getAttribute("data-theme");
    await testInfo.attach("account-menu-pointer-geometry", {
      body: JSON.stringify({ viewport: page.viewportSize(), theme, actualTheme, withCover, targets }),
      contentType: "application/json",
    });
    await testInfo.attach("account-menu-before-pointer-sign-out", {
      body: await page.screenshot(), contentType: "image/png",
    });
    expect(actualTheme).toBe(theme);
    for (const target of targets) {
      expect(target.inViewport, `${target.label} center stays in the viewport`).toBe(true);
      expect(target.ownsCenter, `${target.label} owns its pointer center`).toBe(true);
    }

    await stub.signedInAs(null);
    await menu.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(menu).toBeHidden();
    const navigation = page.getByRole("navigation", { name: "Site navigation" });
    await expect(navigation.getByRole("button", { name: "Sign in", exact: true })
      .or(navigation.getByRole("link", { name: "Sign in", exact: true })).first()).toBeVisible();
  });
}
