import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_PAL_DRAFT } from "../lib/pubPal";
import { ACCOUNTS, installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";
import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";
import { expectMapLoadingFrameReleased } from "./helpers/mobileMapShell";

test.use({ serviceWorkers: "block" });

async function prepare(page: Page, signedIn: boolean) {
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  if (!signedIn) return;
  await installAuthDoubles(page);
  const now = "2026-11-06T12:00:00.000Z";
  const pal = {
    ...DEFAULT_PAL_DRAFT,
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ownerId: ACCOUNTS.A.id,
    name: "WWWWWWWWWW",
    adultAttestedAt: now,
    muted: false,
    hidden: false,
    proposalPreferences: {},
    masteryPoints: 0,
    createdAt: now,
    updatedAt: now,
  };
  await page.route("**/api/pub-pal", (route) => route.fulfill({ json: { pal, adultOnFile: true } }));
  await page.addInitScript((stored) => {
    localStorage.setItem("pubmax_account_owner", stored.ownerId);
    localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(stored));
  }, pal);
  await seedSignedIn(page, "A");
}

// Oracle: the captain's design re-review requires one row from 1024px and
// no extra 50px map-toolbar displacement. Reject wrapping, overlap and clipping.
for (const width of [1024, 1100, 1180]) {
  for (const signedIn of [false, true]) {
    test(`map navigation and toolbar stay separate at ${width}px, ${signedIn ? "signed in" : "signed out"}`, async ({ page }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height: 900 });
      await prepare(page, signedIn);
      await installDeterministicMapBasemap(page);
      await page.goto("/map");
      await expectMapLoadingFrameReleased(page);
      await page.evaluate(() => document.fonts.ready);
      const header = page.locator(".siteNavBar");
      if (signedIn) await expect(header.getByRole("button", { name: /Account options/ })).toBeVisible();
      const toolbar = page.locator(".mapToolbar");
      await expect(toolbar).toBeVisible();
      const row = await header.boundingBox();
      const tools = await toolbar.boundingBox();
      expect(row!.height).toBeLessThanOrEqual(66);
      expect(tools!.y).toBeGreaterThanOrEqual(row!.y + row!.height);
      expect(tools!.y).toBeLessThan(row!.y + row!.height + 40);
      const controls = header.locator("a:visible, button:visible");
      for (const control of await controls.all()) {
        const box = (await control.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(row!.y);
        expect(box.y + box.height).toBeLessThanOrEqual(row!.y + row!.height);
        expect(await control.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        })).toBe(true);
      }
      await info.attach("map-header-and-toolbar", { body: await page.screenshot(), contentType: "image/png" });
      await info.attach("map-geometry", { body: JSON.stringify({ width, signedIn, header: row, toolbar: tools }), contentType: "application/json" });
    });
  }
}

// Compact controls must still answer mouse and keyboard input. Exercise both
// sides of the 1280px boundary and the newly affected 901-1023px band.
for (const width of [901, 1023, 1024, 1100, 1180, 1279, 1280]) {
  test(`compact navigation controls still work at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await prepare(page, true);
    await page.goto("/plan");
    const header = page.locator(".siteNavBar");
    await expect(header.getByRole("button", { name: /Account options/ })).toBeVisible();
    const more = header.getByRole("button", { name: "More pages", exact: true });
    await expect(async () => {
      await more.click();
      await expect(page.getByRole("menu", { name: "More pages", exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    await info.attach("compact-more-menu", { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await page.keyboard.press("Control+k");
    const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole("combobox", { name: "Search commands", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await header.getByRole("link", { name: "Pub Pal, WWWWWWWWWW", exact: true }).click();
    await expect(page).toHaveURL(/\/pal$/);
    await info.attach("pal-destination", { body: await page.screenshot(), contentType: "image/png" });
  });
}
