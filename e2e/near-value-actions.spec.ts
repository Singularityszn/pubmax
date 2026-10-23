import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { NEAR_PRICE_TRUST_CAPTION } from "@/lib/nearPriceTrust";
import { uiUxChromiumProjectUse } from "@/scripts/lib/uiUxBattleTestBrowser.mjs";
import { desktopVenueDrawer, expectSoleDesktopDrawer } from "@/e2e/helpers/mapSurfaceDrawers";
import { expectMobileMapShellReady, mobileMapShellControl } from "@/e2e/helpers/mobileMapShell";

// The painted-map shots below need a real WebGL context, so this file launches
// with the same SwiftShader arguments chromium-gl uses, the way
// e2e/area-news-toast.spec.ts does from the plain chromium project.
test.use(uiUxChromiumProjectUse(process.env.UI_UX_BROWSER_CHANNEL));

test.setTimeout(60_000);

// A first-time /near reader sees listed prices, then two actions on each row:
// the row itself opens the pub (it says "View pub"), and Keep for tonight is the
// separate bordered control that starts a Plan handoff. These checks hold the
// two apart by eye, by keyboard, by a real tap or click, and at a phone's
// narrowest width and a desktop's, in both themes, and keep the trust captions
// whole while the cue sits beside the price. The map's own Near me sheet shows
// the same rows browse-only, so it is held to the same cue with no Keep at all.

const PLANNING_INTENT_KEY = "pubmax:planning-intent:v1";
// lib/savedPubs.ts. Browsing a pub is not saving it.
const SAVED_PUBS_KEY = "pubmax:savedPubs:v1";

const LAYOUTS = [
  { name: "320x844", width: 320, height: 844, phone: true },
  { name: "390x844", width: 390, height: 844, phone: true },
  { name: "1440x900", width: 1440, height: 900, phone: false },
] as const;
type Layout = (typeof LAYOUTS)[number];

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/** A granted fix at a fixed City of London point, as e2e/map-arrival.spec.ts uses. */
const GRANTED_FIX = { latitude: 51.515, longitude: -0.09 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function prepareReader(page: Page, layout: Layout, theme: Theme): Promise<void> {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: theme });
  await page.addInitScript((initialTheme) => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax-theme", initialTheme);
    // Arm pin-reveal before any /map navigation, as e2e/screenshots.spec.ts
    // does, so a map shot can wait on the product's own ready signal.
    const revealWindow = window as typeof window & {
      __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
    };
    if (!revealWindow.__pubmaxPinRevealTrace) {
      const trace: Array<{ reason: string; generation: number }> = [];
      revealWindow.__pubmaxPinRevealTrace = trace;
      window.addEventListener("pubmax:pin-reveal", (event) => {
        trace.push(
          (event as CustomEvent<{ reason: string; generation: number }>).detail,
        );
      });
    }
  }, theme);
}

async function returnFromSelectedMapToNear(page: Page): Promise<void> {
  await page.goBack();
  if (new URL(page.url()).pathname === "/map") {
    await expect(page).not.toHaveURL(/[?&]sel=/);
    await page.goBack();
  }
  await expect(page).toHaveURL(/\/near\?patch=soho/);
}

async function grantLocation(page: Page): Promise<void> {
  await page.addInitScript((fix) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({ coords: { ...fix, accuracy: 10 } } as GeolocationPosition);
        },
        watchPosition: () => 0,
        clearWatch: () => {},
      },
    });
  }, GRANTED_FIX);
}

async function openNear(page: Page, theme: Theme): Promise<void> {
  const response = await page.goto("/near?patch=soho");
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function storedIntent(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.sessionStorage.getItem(key), PLANNING_INTENT_KEY);
}

async function storedSavedPubs(page: Page): Promise<string | null> {
  return page.evaluate((key) => window.localStorage.getItem(key), SAVED_PUBS_KEY);
}

/** A real tap on a phone layout (the context has touch), a real click on desktop. */
async function press(layout: Layout, control: Locator): Promise<void> {
  if (layout.phone) await control.tap();
  else await control.click();
}

/**
 * The selected pub's own surface: the phone's venue sheet, or the desktop's
 * venue drawer as the only open drawer. Either one has to name the pub the
 * reader picked, so a URL carrying `sel=` is never the whole proof.
 */
async function expectSelectedVenue(page: Page, layout: Layout, name: string): Promise<Locator> {
  if (layout.phone) {
    await expectMobileMapShellReady(page);
    const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await expect(sheet.locator(".venueInspector")).toContainText(name, { timeout: 60_000 });
    return sheet;
  }
  await expectSoleDesktopDrawer(page, "venue");
  const drawer = desktopVenueDrawer(page);
  await expect(drawer.locator(".venueInspector")).toContainText(name, { timeout: 60_000 });
  return drawer;
}

/** Count pub marks the map is painting right now (pins + clusters). */
async function paintedMapMarkCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => unknown[];
      }
    ).__pubmaxPaintedMapTapPoints;
    return probe?.().length ?? 0;
  });
}

async function pinRevealCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPinRevealTrace?: Array<{ reason: string; generation: number }>;
        }
      ).__pubmaxPinRevealTrace?.length ?? 0,
  );
}

/**
 * The map has painted pubs: e2e/screenshots.spec.ts's gate, unchanged. The
 * pin-reveal lifecycle ran, at least one painted mark survived collision and
 * chrome, no loading shell or fallback is up, and the canvas is visible.
 */
async function waitForLoadedMap(page: Page): Promise<void> {
  await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 20_000 });
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect
    .poll(() => pinRevealCount(page), {
      message: "map visual gate requires the pin-reveal lifecycle",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await expect
    .poll(() => paintedMapMarkCount(page), {
      message: "map visual gate requires at least one tappable painted pub mark",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);
  await expect(page.locator(".mapLoading")).toHaveCount(0);
  await expect(page.getByText("Loading London pubs")).toHaveCount(0);
  await expect(page.locator(".mapFallback")).toHaveCount(0);
  await expect(page.locator(".maplibreMap canvas, .maplibregl-canvas").first()).toBeVisible();
}

/** Shoot the viewport into this test's own output folder and attach it to the report. */
async function recordShot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await expect
    .poll(
      () => page.evaluate(() => document.getAnimations().filter(
        (animation) => animation.playState === "running" && animation.timeline === document.timeline,
      ).length),
      { message: "screenshot surface has finished its visual transitions", timeout: 15_000 },
    )
    .toBe(0);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

/** The first row's pub name, read off the row the reader is about to press. */
async function rowName(browse: Locator): Promise<string> {
  const name = (await browse.locator(".nmnCardName").textContent())?.trim() ?? "";
  expect(name).not.toBe("");
  return name;
}

/** The pub a Keep control names in its own accessible name. */
async function keptName(keep: Locator): Promise<string> {
  const label = (await keep.getAttribute("aria-label")) ?? "";
  const name = /^Keep (.+) for tonight$/.exec(label)?.[1] ?? "";
  expect(name).not.toBe("");
  return name;
}

/**
 * Keep's canonical handoff, as e2e/near-venue-acceptance.spec.ts holds it: the
 * accept deep link, the Map's receipt and Make it Stop 1 on the kept pub's own
 * surface, and one PlanningIntent recorded from Near.
 */
async function expectKeptHandoff(page: Page, layout: Layout, name: string): Promise<Locator> {
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=[^&]+&accept=1&src=near/);
  const surface = await expectSelectedVenue(page, layout, name);
  await expect(page.getByText("Kept for tonight. Make it Stop 1 when you are ready.")).toBeVisible();
  const acceptStop1 = surface.getByRole("button", { name: /^Make .+ Stop 1$/ });
  await expect(acceptStop1).toBeVisible({ timeout: 30_000 });
  await expect(acceptStop1).toHaveText("Make it Stop 1");
  await expect(page).toHaveURL(/[?&]accept=1(&|$)/);
  await expect(page).toHaveURL(/[?&]src=near(&|$)/);
  const stored = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, PLANNING_INTENT_KEY);
  expect(stored?.source).toBe("near");
  expect(stored?.acceptedVenueId).toBeTruthy();
  return surface;
}

/** Browse only: the pub opened with no accept marker, no receipt and nothing written. */
async function expectBrowseOnly(page: Page): Promise<void> {
  await expect(page).not.toHaveURL(/[?&]accept=1(&|$)/);
  await expect(page.locator(".venueAcceptanceReceipt")).toHaveCount(0);
  expect(await storedIntent(page)).toBeNull();
  expect(await storedSavedPubs(page)).toBeNull();
}

for (const layout of LAYOUTS) {
  for (const theme of THEMES) {
    test.describe(`${layout.name} ${theme}`, () => {
      test("each /near row says View pub and keeps it apart from Keep for tonight", async ({ page }, testInfo) => {
        const errors = watchPageErrors(page);
        await prepareReader(page, layout, theme);
        await openNear(page, theme);

        const rows = page.locator(".nmnCardRow");
        await expect(rows.first()).toBeVisible();
        const count = await rows.count();
        expect(count).toBeGreaterThan(0);
        await expect(page.locator(".nmnCardBrowse .nmnCardView")).toHaveCount(count);
        await expect(page.locator(".nmnCardBrowse .nmnCardView").first()).toHaveText("View pub");
        await expect(page.locator(".nmnAccept .nmnCardView")).toHaveCount(0);
        await expect(page.locator(".nmnAccept").first()).toHaveText("Keep for tonight");

        // Distinct by eye: the cue has no edge and no fill, the Keep action has both.
        const looks = await page.evaluate(() => {
          const cue = getComputedStyle(document.querySelector(".nmnCardView") as Element);
          const keep = getComputedStyle(document.querySelector(".nmnAccept") as Element);
          return {
            cueBorder: cue.borderTopWidth,
            cueFill: cue.backgroundColor,
            keepBorder: keep.borderTopWidth,
            keepFill: keep.backgroundColor,
          };
        });
        expect(looks.cueBorder).toBe("0px");
        expect(looks.cueFill).toBe("rgba(0, 0, 0, 0)");
        expect(looks.keepBorder).not.toBe("0px");
        expect(looks.keepFill).not.toBe("rgba(0, 0, 0, 0)");

        // The browse button's name ends with the action it takes.
        await expect(
          page.getByRole("button", { name: /View pub$/ }).first(),
        ).toBeVisible();

        // Answer first: the answer's heading, then the list's one price caption,
        // then the rows, and the first row's price is on screen on arrival.
        await expect(page.getByRole("heading", { name: "Cheapest listed around Soho" })).toBeVisible();
        await expect(page.locator(".nmnPriceCollected")).toHaveText(NEAR_PRICE_TRUST_CAPTION);
        const head = await page.locator("section.nmn .nmnHead").boundingBox();
        const caption = await page.locator(".nmnListCaption").boundingBox();
        const firstRow = await rows.first().boundingBox();
        expect(head).not.toBeNull();
        expect(caption).not.toBeNull();
        expect(firstRow).not.toBeNull();
        expect(head!.y + head!.height).toBeLessThanOrEqual(caption!.y + 0.5);
        expect(caption!.y + caption!.height).toBeLessThanOrEqual(firstRow!.y + 0.5);
        await expect(rows.first().locator(".nmnCardPriceValue")).toBeInViewport();
        await expect(rows.first().locator(".nmnCardTrust")).toBeInViewport();
        await recordShot(page, testInfo, `near-first-answer-${layout.name}-${theme}`);

        expect(await storedIntent(page)).toBeNull();
        expect(errors).toEqual([]);
      });

      test("keyboard: Tab goes View pub then Keep, Enter on View pub only browses", async ({ page }, testInfo) => {
        const errors = watchPageErrors(page);
        await prepareReader(page, layout, theme);
        await openNear(page, theme);

        const browse = page.locator(".nmnCardBrowse").first();
        await expect(browse).toBeVisible();
        const browsedName = await rowName(browse);
        await browse.focus();
        await expect(browse).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(page.locator(".nmnAccept").first()).toBeFocused();
        await recordShot(page, testInfo, `near-action-keep-focus-${layout.name}-${theme}`);
        await page.keyboard.press("Shift+Tab");
        await expect(browse).toBeFocused();

        // The focus ring is drawn on the row a keyboard reader is on.
        const outline = await browse.evaluate((node) => getComputedStyle(node).outlineStyle);
        expect(outline).not.toBe("none");

        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
        await expect(page).not.toHaveURL(/[?&]accept=1(&|$)/);
        expect(await storedIntent(page)).toBeNull();
        // Enter opened THAT pub, not just a URL that names one.
        await expectSelectedVenue(page, layout, browsedName);
        await expectBrowseOnly(page);

        await returnFromSelectedMapToNear(page);
        const keep = page.locator(".nmnAccept").first();
        await expect(keep).toBeVisible();
        const keepName = await keptName(keep);
        await keep.focus();
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=[^&]+&accept=1&src=near/);
        expect(await storedIntent(page)).not.toBeNull();
        await expectKeptHandoff(page, layout, keepName);
        expect(errors).toEqual([]);
      });

      test("the cue fits its row and the trust captions stay whole", async ({ page }, testInfo) => {
        const errors = watchPageErrors(page);
        await prepareReader(page, layout, theme);
        await openNear(page, theme);

        await expect(page.locator(".nmnCardRow").first()).toBeVisible();
        await expect(page.locator(".nmnCardTrust")).not.toHaveCount(0);
        await expect(page.locator(".nmnPriceCollected")).toHaveText(NEAR_PRICE_TRUST_CAPTION);
        await expect(page.locator(".nmnListCaption")).toHaveCount(1);

        const fit = await page.evaluate(() => {
          const clipped = (node: Element) => {
            const el = node as HTMLElement;
            return el.scrollWidth > el.clientWidth;
          };
          const within = (inner: DOMRect, outer: DOMRect) =>
            inner.left >= outer.left - 0.5 &&
            inner.right <= outer.right + 0.5 &&
            inner.top >= outer.top - 0.5 &&
            inner.bottom <= outer.bottom + 0.5;
          return Array.from(document.querySelectorAll(".nmnCardBrowse")).map((button) => {
            const cue = button.querySelector(".nmnCardView") as HTMLElement;
            const price = button.querySelector(".nmnCardPriceValue") as HTMLElement;
            const box = button.getBoundingClientRect();
            return {
              cueInside: within(cue.getBoundingClientRect(), box),
              priceInside: within(price.getBoundingClientRect(), box),
              cueClipped: clipped(cue),
              nameClipped: clipped(button.querySelector(".nmnCardName") as Element),
              trustClipped: Array.from(button.querySelectorAll(".nmnCardTrust")).some(clipped),
            };
          });
        });
        expect(fit.length).toBeGreaterThan(0);
        for (const row of fit) {
          expect(row).toEqual({
            cueInside: true,
            priceInside: true,
            cueClipped: false,
            nameClipped: false,
            trustClipped: false,
          });
        }
        // Keep for tonight keeps its words whole and stays inside the page.
        const keepFit = await page.evaluate(() =>
          Array.from(document.querySelectorAll(".nmnAccept")).map((node) => {
            const el = node as HTMLElement;
            const box = el.getBoundingClientRect();
            return {
              clipped: el.scrollWidth > el.clientWidth,
              inside: box.left >= -0.5 && box.right <= document.documentElement.clientWidth + 0.5,
            };
          }),
        );
        expect(keepFit.length).toBe(fit.length);
        for (const keep of keepFit) expect(keep).toEqual({ clipped: false, inside: true });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await page.locator(".nmnPriceCollected").scrollIntoViewIfNeeded();
        await recordShot(page, testInfo, `near-list-${layout.name}-${theme}`);
        expect(errors).toEqual([]);
      });
    });

    test.describe(`${layout.name} ${theme} real controls`, () => {
      // A phone layout is pressed with a real tap; desktop with a real click.
      test.use({ hasTouch: layout.phone });

      test(`${layout.phone ? "tap" : "click"}: View pub opens that pub browse-only, Keep hands it off`, async ({ page }) => {
        const errors = watchPageErrors(page);
        await prepareReader(page, layout, theme);
        await openNear(page, theme);

        // The rows are drawn by the client once the priced index answers, so a
        // visible row is already hydrated: the press needs no retry.
        const browse = page.locator(".nmnCardBrowse").first();
        await expect(browse).toBeVisible();
        const browsedName = await rowName(browse);
        expect(await storedIntent(page)).toBeNull();
        expect(await storedSavedPubs(page)).toBeNull();

        // The cue is part of the row's one tap, so pressing the words opens the pub.
        await press(layout, browse.locator(".nmnCardView"));
        await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
        await expectSelectedVenue(page, layout, browsedName);
        await expectBrowseOnly(page);

        await returnFromSelectedMapToNear(page);
        const keep = page.locator(".nmnAccept").first();
        await expect(keep).toBeVisible();
        const keepName = await keptName(keep);
        await press(layout, keep);
        await expectKeptHandoff(page, layout, keepName);
        // Keep records the handoff, never a saved pub.
        expect(await storedSavedPubs(page)).toBeNull();
        expect(errors).toEqual([]);
      });

      if (layout.phone) {
        test("the map's Near me sheet shows View pub rows browse-only and opens the picked pub", async ({ page }) => {
          const errors = watchPageErrors(page);
          await grantLocation(page);
          await prepareReader(page, layout, theme);
          const response = await page.goto("/map");
          expect(response?.status()).toBe(200);
          await expectMobileMapShellReady(page);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

          await press(layout, await mobileMapShellControl(page, "nearMe"));
          const nearMeSheet = page.locator('.mobileSheetPortal[data-sheet-kind="near-me"]');
          await expect(nearMeSheet).toBeVisible({ timeout: 20_000 });
          const answer = nearMeSheet.locator("section.nmn");
          const cards = answer.locator(".nmnList > li .nmnCard");
          await expect(cards.first()).toBeVisible({ timeout: 20_000 });
          const count = await cards.count();
          expect(count).toBeGreaterThan(0);

          // The embedded answer is browse-only (NearMeNow without acceptance):
          // the same cue on every row, and no Keep, receipt or row pair at all.
          await expect(answer.locator(".nmnCard .nmnCardView")).toHaveCount(count);
          await expect(answer.locator(".nmnCardView").first()).toHaveText("View pub");
          await expect(answer.locator(".nmnAccept")).toHaveCount(0);
          await expect(answer.locator(".nmnCardRow")).toHaveCount(0);
          await expect(answer.locator(".nmnAcceptReceipt")).toHaveCount(0);
          await expect(answer.locator(".nmnListCaption")).toHaveCount(1);

          const fit = await answer.evaluate((section) =>
            Array.from(section.querySelectorAll(".nmnCard")).map((button) => {
              const box = button.getBoundingClientRect();
              const inside = (node: Element | null) => {
                if (!node) return false;
                const rect = node.getBoundingClientRect();
                return rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5;
              };
              const name = button.querySelector(".nmnCardName") as HTMLElement;
              return {
                cueInside: inside(button.querySelector(".nmnCardView")),
                priceInside: inside(button.querySelector(".nmnCardPriceValue")),
                nameClipped: name.scrollWidth > name.clientWidth,
              };
            }),
          );
          for (const row of fit) {
            expect(row).toEqual({ cueInside: true, priceInside: true, nameClipped: false });
          }
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);

          // The host's own select callback opens the pub in place on the map.
          const first = cards.first();
          const pickedName = await rowName(first);
          await press(layout, first.locator(".nmnCardView"));
          await expectSelectedVenue(page, layout, pickedName);
          await expectBrowseOnly(page);
          expect(errors).toEqual([]);
        });
      }

      test("map surfaces are shot only over a painted map", async ({ page }, testInfo) => {
        test.setTimeout(180_000);
        const errors = watchPageErrors(page);
        if (layout.phone) await grantLocation(page);
        await prepareReader(page, layout, theme);
        await openNear(page, theme);

        // Browse: the selected pub on its own surface. A full phone sheet and a
        // docked desktop drawer can both cover every painted mark, so prove the
        // live scene with the pub closed, then restore the same history entry
        // for the shot, as e2e/screenshots.spec.ts does.
        const browse = page.locator(".nmnCardBrowse").first();
        await expect(browse).toBeVisible();
        const browsedName = await rowName(browse);
        await press(layout, browse);
        await expectSelectedVenue(page, layout, browsedName);
        await expectBrowseOnly(page);
        await page.getByRole("button", { name: "Close pub detail" }).click();
        await waitForLoadedMap(page);
        await recordShot(page, testInfo, `map-clean-${layout.name}-${theme}`);
        await page.goForward();
        await expectSelectedVenue(page, layout, browsedName);
        await expectBrowseOnly(page);
        await recordShot(page, testInfo, `map-selected-browse-${layout.name}-${theme}`);

        // Keep: the accepted arrival on the kept pub's own surface.
        await openNear(page, theme);
        const keep = page.locator(".nmnAccept").first();
        await expect(keep).toBeVisible();
        const keepName = await keptName(keep);
        await press(layout, keep);
        await expectKeptHandoff(page, layout, keepName);
        await page.getByRole("button", { name: "Close pub detail" }).click();
        await waitForLoadedMap(page);
        await page.goForward();
        await expectSelectedVenue(page, layout, keepName);
        await expect(page).toHaveURL(/[?&]accept=1(&|$)/);
        await expect(page).toHaveURL(/[?&]src=near(&|$)/);
        await recordShot(page, testInfo, `map-kept-${layout.name}-${theme}`);

        if (layout.phone) {
          // The embedded Near me sheet over a map already proven painted.
          const response = await page.goto("/map");
          expect(response?.status()).toBe(200);
          await expectMobileMapShellReady(page);
          await waitForLoadedMap(page);
          await press(layout, await mobileMapShellControl(page, "nearMe"));
          const nearMeSheet = page.locator('.mobileSheetPortal[data-sheet-kind="near-me"]');
          await expect(nearMeSheet).toBeVisible({ timeout: 20_000 });
          await expect(nearMeSheet.locator(".nmnCard .nmnCardView").first()).toBeVisible({
            timeout: 20_000,
          });
          await expect(nearMeSheet.locator(".nmnAccept")).toHaveCount(0);
          await recordShot(page, testInfo, `map-near-me-sheet-${layout.name}-${theme}`);
        }
        expect(errors).toEqual([]);
      });
    });
  }
}
