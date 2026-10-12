import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { stubSocialAuthProviders } from "./helpers/authDoubles";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

// The keyless build points Supabase at a host that does not resolve, so a
// page that opens the realtime socket logs a DNS error unless the spec
// answers for it.
async function stubKeylessSupabase(page: Page): Promise<void> {
  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    }),
  );
  await page.routeWebSocket(
    "wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**",
    () => {},
  );
  await stubSocialAuthProviders(page);
}

async function prepareMobilePage(
  page: Page,
  theme: "light" | "dark" = "light",
  viewport = MOBILE_VIEWPORT,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubKeylessSupabase(page);
  await page.addInitScript((initialTheme) => {
    window.localStorage.setItem("pubmax-theme", initialTheme);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  }, theme);
}

function watchBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const { url } = message.location();
    errors.push(`console: ${message.text()}${url ? ` (${url})` : ""}`);
  });
  return errors;
}

// The phone sheet is absolute inside the fixed .mobileSheetPortal (#952,
// QA H02). The portal stops above a shown tab bar, so the sheet never takes a
// tab tap. Only the keyboard hides the bar, and then the portal and the sheet
// reach the bottom edge, with no strip of map under the sheet. The header and
// the footer are never clipped by the sheet's own cap.
async function expectSheetInsideViewport(
  page: Page,
  sheet: Locator,
  footer?: Locator,
): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect(sheet).not.toHaveClass(/sheet-settling/);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect(async () => {
    const geometry = await sheet.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const portal = element.closest(".mobileSheetPortal");
      const tabBar = document.querySelector(".mobileTabBar");
      const tabBarStyle = tabBar ? getComputedStyle(tabBar) : null;
      const tabBarRect = tabBar?.getBoundingClientRect() ?? null;
      let tabBarState: "shown" | "hidden" | "moving" = "hidden";
      if (tabBar && tabBarStyle && tabBarRect && tabBarStyle.display !== "none") {
        if (tabBarStyle.opacity === "1" && tabBarStyle.transform === "none") tabBarState = "shown";
        else if (tabBarStyle.opacity !== "0" || tabBarRect.top < window.innerHeight) tabBarState = "moving";
      }
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        height: rect.height,
        position: style.position,
        transform: style.transform,
        portalPosition: portal ? getComputedStyle(portal).position : null,
        portalBottom: portal?.getBoundingClientRect().bottom ?? null,
        tabBar: tabBarState,
        tabBarTop: tabBarRect?.top ?? null,
        tabBarReserve: Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--tabbar-h"),
        ),
      };
    });
    expect(geometry.tabBar).not.toBe("moving");
    expect(geometry.portalPosition).toBe("fixed");
    expect(geometry.position).toBe("absolute");
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(geometry.transform);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(viewport!.width + 1);
    expect(geometry.height).toBeLessThanOrEqual(viewport!.height);
    expect(Math.abs(geometry.bottom - geometry.portalBottom!)).toBeLessThanOrEqual(1);
    if (geometry.tabBar === "shown") {
      expect(Math.abs(geometry.bottom - (viewport!.height - geometry.tabBarReserve))).toBeLessThanOrEqual(1);
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.tabBarTop! + 1);
    } else {
      expect(geometry.bottom).toBeLessThanOrEqual(viewport!.height + 1);
      expect(geometry.bottom).toBeGreaterThanOrEqual(viewport!.height - 1);
    }
  }).toPass({ timeout: 5_000 });

  if (footer) await expect(footer).toBeVisible();
  await expect(async () => {
    const sheetBox = (await sheet.boundingBox())!;
    const headerBox = (await sheet.locator(".mobileSharedSheetHeader").boundingBox())!;
    expect(headerBox.y).toBeGreaterThanOrEqual(sheetBox.y - 1);
    expect(headerBox.y + headerBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 1);
    if (!footer) return;
    const footerBox = (await footer.boundingBox())!;
    expect(footerBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(viewport!.height + 1);
    expect(Math.abs(footerBox.y + footerBox.height - (sheetBox.y + sheetBox.height))).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 5_000 });
}

async function attachViewportShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.setTimeout(90_000);

for (const viewport of [MOBILE_VIEWPORT, { width: 320, height: 568 }]) {
  test(`mobile venue footer stays pinned and actionable at every sheet detent at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const size = `${viewport.width}x${viewport.height}`;
    await prepareMobilePage(page, "light", viewport);
    // The Share tap answers in the footer only when no native share sheet
    // takes it, as in the headless shell. Desktop Chrome has one.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
    });
    const browserErrors = watchBrowserErrors(page);

    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    expect(response?.status()).toBe(200);

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const sheet = portal.locator(".mobileSharedSheet");
    const footer = portal.locator(".mobileSharedSheetFooter");
    const body = portal.locator(".mobileSharedSheetBody");
    // The footer carries no price action (the Overview's one price door owns
    // that, #1517); Share is the command every pub sheet keeps, so it is the one
    // held in view at every detent, and its tap answers in the footer itself.
    const share = portal.getByRole("button", { name: "Share Arnos Arms" });

    await expect(sheet).toHaveClass(/sheet-half/);
    await expectSheetInsideViewport(page, sheet, footer);
    await expect(share).toBeInViewport();
    await attachViewportShot(page, testInfo, `venue-half-${size}`);

    const footerBeforeScroll = await footer.boundingBox();
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const footerAfterScroll = await footer.boundingBox();
    expect(footerAfterScroll?.y).toBeCloseTo(footerBeforeScroll!.y, 0);

    await sheet.getByRole("button", { name: "Expand sheet" }).click();
    await expect(sheet).toHaveClass(/sheet-full/);
    await expectSheetInsideViewport(page, sheet, footer);
    await expect(share).toBeInViewport();
    await attachViewportShot(page, testInfo, `venue-full-${size}`);

    await sheet.getByRole("button", { name: "Collapse sheet" }).click();
    await expect(sheet).toHaveClass(/sheet-half/);

    const header = sheet.locator(".mobileSharedSheetHeader");
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();
    const dragX = headerBox!.x + 18;
    const dragY = headerBox!.y + headerBox!.height - 10;
    await page.mouse.move(dragX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragY + Math.round(viewport.height * 0.3), { steps: 12 });
    await page.mouse.up();

    await expect(sheet).toHaveClass(/sheet-peek/);
    await expectSheetInsideViewport(page, sheet, footer);
    await expect(share).toBeInViewport();
    await expect(body).toBeHidden();
    await expect.poll(() => body.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(1);
    await attachViewportShot(page, testInfo, `venue-peek-${size}`);
    await share.click();
    await expect(footer.locator(".venueSheetShareFeedback")).toBeVisible();

    expect(browserErrors).toEqual([]);
  });
}

test("mobile planner and contextual portal sheets retain the canonical bottom anchor", async ({ page }) => {
  await prepareMobilePage(page);
  const browserErrors = watchBrowserErrors(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Describe the outing" }).click();
  const planner = page.locator('.mobileSheetPortal[data-sheet-kind="planner"]');
  await expect(planner).toBeVisible();
  await expectSheetInsideViewport(page, planner.locator(".mobileSharedSheet"));
  await expect(planner.locator(".mobileSharedSheetFooter")).toBeHidden();
  await planner.getByRole("button", { name: "Close planner" }).click();
  await expect(planner).toHaveCount(0);

  await page.getByRole("button", { name: "More map controls" }).click();
  const layers = page.locator('.mobileSheetPortal[data-sheet-kind="layers"]');
  await expect(layers).toBeVisible();
  await expectSheetInsideViewport(page, layers.locator(".mobileSharedSheet"));
  await expect(layers.locator(".mobileSharedSheetFooter")).toBeHidden();

  expect(browserErrors).toEqual([]);
});

test("desktop keeps the legacy inline venue drawer without the mobile portal layout", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubKeylessSupabase(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  const browserErrors = watchBrowserErrors(page);

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileSheetPortal")).toHaveCount(0);

  const drawer = page.locator(".mapDrawer.right.open");
  await expect(drawer).toBeVisible();
  await expect(drawer).not.toHaveClass(/mobileSharedSheet/);
  const box = await drawer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1441);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(901);

  expect(browserErrors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`mobile venue sheet ${theme} reduced-motion evidence`, async ({ page }, testInfo) => {
    await prepareMobilePage(page, theme);
    const browserErrors = watchBrowserErrors(page);

    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const sheet = portal.locator(".mobileSharedSheet");
    const footer = portal.locator(".mobileSharedSheetFooter");
    await expect(sheet).toHaveClass(/sheet-half/);
    await expectSheetInsideViewport(page, sheet, footer);
    await attachViewportShot(page, testInfo, `mobile-shared-sheet-${theme}-390x844`);

    expect(browserErrors).toEqual([]);
  });
}
