import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

type VenueShareObservation = {
  clipboardAvailable: boolean;
  shares: Array<{
    data: { title?: string; text?: string; url?: string };
    outcome: "pending" | "shared" | "cancelled" | "failed";
  }>;
  windows: Array<{
    href: string;
    target: string | undefined;
    features: string | undefined;
    opened: boolean;
  }>;
  copies: Array<{ url: string; outcome: "pending" | "copied" | "failed" }>;
};

// Observe real browser APIs without supplying a native result, popup handle or
// clipboard permission. The same tap can legitimately succeed, be dismissed,
// or fall back; each outcome has its own product response.
async function observeVenueShare(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalShare = navigator.share?.bind(navigator);
    const originalOpen = window.open.bind(window);
    const originalCopy = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    const observation: VenueShareObservation = {
      clipboardAvailable: Boolean(originalCopy),
      shares: [],
      windows: [],
      copies: [],
    };
    (window as typeof window & { __venueShareObservation: VenueShareObservation })
      .__venueShareObservation = observation;
    if (originalShare) {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          const attempt: VenueShareObservation["shares"][number] = {
            data,
            outcome: "pending",
          };
          observation.shares.push(attempt);
          try {
            await originalShare(data);
            attempt.outcome = "shared";
          } catch (error) {
            attempt.outcome =
              typeof error === "object" && error !== null &&
                "name" in error && error.name === "AbortError"
                ? "cancelled"
                : "failed";
            throw error;
          }
        },
      });
    }
    window.open = (url, target, features) => {
      const attempt = { href: String(url ?? ""), target, features, opened: false };
      observation.windows.push(attempt);
      const opened = originalOpen(url, target, features);
      attempt.opened = Boolean(opened);
      return opened;
    };
    if (originalCopy) {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: async (url: string) => {
          const attempt: VenueShareObservation["copies"][number] = {
            url,
            outcome: "pending",
          };
          observation.copies.push(attempt);
          try {
            await originalCopy(url);
            attempt.outcome = "copied";
          } catch (error) {
            attempt.outcome = "failed";
            throw error;
          }
        },
      });
    }
  });
}

async function readVenueShare(page: Page): Promise<VenueShareObservation> {
  return page.evaluate(() =>
    (window as typeof window & { __venueShareObservation: VenueShareObservation })
      .__venueShareObservation,
  );
}

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
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
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
}

async function prepareMobilePage(page: Page, theme: "light" | "dark" = "light"): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
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
// tab tap. A venue or the planner hides the bar, and then the portal and the
// sheet reach the bottom edge, with no strip of map under the sheet.
async function expectSheetInsideViewport(
  page: Page,
  sheet: Locator,
  footer?: Locator,
): Promise<void> {
  await expect(sheet).toBeVisible();
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

  if (!footer) return;
  await expect(footer).toBeVisible();
  const footerBox = await footer.boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y).toBeGreaterThanOrEqual(0);
  expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  const sheetBottom = await sheet.evaluate((element) => element.getBoundingClientRect().bottom);
  expect(footerBox!.y + footerBox!.height).toBeGreaterThanOrEqual(sheetBottom - 1);
}

async function attachViewportShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

test.setTimeout(90_000);

test("mobile venue footer stays pinned and actionable at every sheet detent", async ({ page }) => {
  await prepareMobilePage(page);
  const browserErrors = watchBrowserErrors(page);

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  const sheet = portal.locator(".mobileSharedSheet");
  const footer = portal.locator(".mobileSharedSheetFooter");
  const body = portal.locator(".mobileSharedSheetBody");
  // The footer carries no price action (the Overview's one price door owns
  // that, #1517); Share is the command every pub sheet keeps, so it is the one
  // held in view at every detent. Fallbacks answer in the footer; a completed
  // or dismissed native share sheet deliberately stays quiet.
  const share = portal.getByRole("button", { name: "Share Arnos Arms" });

  await expect(sheet).toHaveClass(/sheet-half/);
  await expectSheetInsideViewport(page, sheet, footer);
  await expect(share).toBeInViewport();

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

  await sheet.getByRole("button", { name: "Collapse sheet" }).click();
  await expect(sheet).toHaveClass(/sheet-half/);

  const header = sheet.locator(".mobileSharedSheetHeader");
  const headerBox = await header.boundingBox();
  expect(headerBox).not.toBeNull();
  const dragX = headerBox!.x + 18;
  const dragY = headerBox!.y + headerBox!.height - 10;
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX, dragY + 260, { steps: 12 });
  await page.mouse.up();

  await expect(sheet).toHaveClass(/sheet-peek/);
  await expectSheetInsideViewport(page, sheet, footer);
  await expect(share).toBeInViewport();
  await observeVenueShare(page);
  await share.click();
  const feedback = footer.locator(".venueSheetShareFeedback");
  await expect.poll(async () => {
    const observed = await readVenueShare(page);
    const nativeOutcome = observed.shares[0]?.outcome;
    return nativeOutcome === "shared" || nativeOutcome === "cancelled" ||
      (observed.windows.length === 1 && await feedback.isVisible());
  }, { timeout: 10_000, message: "the actual share tap reaches a recorded outcome" })
    .toBe(true);
  const observed = await readVenueShare(page);
  const canonicalUrl = new URL(`/map?sel=${ARNOS_ARMS_ID}`, page.url()).toString();
  expect(observed.shares.length).toBeLessThanOrEqual(1);
  const nativeShare = observed.shares[0];
  if (nativeShare) {
    expect(Object.keys(nativeShare.data).sort()).toEqual(["text", "title", "url"]);
    expect(nativeShare.data.title).toBe("Arnos Arms");
    expect(nativeShare.data.text).toContain("Arnos Arms");
    expect(nativeShare.data.url).toBe(canonicalUrl);
  }
  if (nativeShare?.outcome === "shared" || nativeShare?.outcome === "cancelled") {
    expect(observed.windows).toEqual([]);
    expect(observed.copies).toEqual([]);
    await expect(feedback).toHaveCount(0);
  } else {
    if (nativeShare) expect(nativeShare.outcome).toBe("failed");
    expect(observed.windows).toHaveLength(1);
    const fallback = observed.windows[0]!;
    const whatsapp = new URL(fallback.href);
    expect(whatsapp.origin).toBe("https://wa.me");
    expect(whatsapp.searchParams.get("text")).toContain("Arnos Arms");
    expect(whatsapp.searchParams.get("text")).toContain(canonicalUrl);
    expect(fallback.target).toBe("_blank");
    expect(fallback.features).toBe("noopener,noreferrer");
    await expect(feedback).toBeVisible();
    if (fallback.opened) {
      expect(observed.copies).toEqual([]);
      await expect(feedback).toHaveText("Opened WhatsApp to share the link.");
    } else if (!observed.clipboardAvailable) {
      expect(observed.copies).toEqual([]);
      await expect(feedback).toHaveText(
        "Sharing and clipboard are unavailable. Copy the page URL.",
      );
    } else {
      expect(observed.copies).toHaveLength(1);
      expect(observed.copies[0]!.url).toBe(canonicalUrl);
      if (observed.copies[0]!.outcome === "copied") {
        await expect(feedback).toHaveText("Share failed, but the link was copied.");
      } else {
        expect(observed.copies[0]!.outcome).toBe("failed");
        await expect(feedback).toHaveText(
          "Couldn't copy the link. Copy it from your browser bar.",
        );
      }
    }
  }

  expect(browserErrors).toEqual([]);
});

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
