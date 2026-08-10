import { expect, test, type Locator, type Page } from "@playwright/test";

import { SURFACE_NAV_HOME_ICON_SIZE } from "@/components/ui/surface-nav";

function stableVenueIdFromKey(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
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

const VIEWPORT = { width: 390, height: 844 };

const TABS: ReadonlyArray<{ label: string; panelId: string }> = [
  { label: "Overview", panelId: "venuePanel-overview" },
  { label: "Photos", panelId: "venuePanel-photos" },
  { label: "Drinks", panelId: "venuePanel-menu" },
  { label: "Stories", panelId: "venuePanel-pints" },
  { label: "Lore", panelId: "venuePanel-story" },
  { label: "Ask", panelId: "venuePanel-ask" },
  { label: "Last train", panelId: "venuePanel-getting-home" },
];

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectTapTarget(locator: Locator, label: string): Promise<void> {
  await expect(locator, `${label} should be visible before measuring`).toBeVisible();
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(box.width, `${label} width should be at least 44px`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height should be at least 44px`).toBeGreaterThanOrEqual(44);
}

async function expectInViewport(locator: Locator, label: string, page: Page): Promise<void> {
  await expect(locator, `${label} should be visible before measuring`).toBeVisible();
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  const viewport = page.viewportSize();
  expect(viewport, "viewport should be set").not.toBeNull();
  expect(box.x, `${label} should not sit off the left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${label} should not sit above the viewport`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} should not sit off the right edge`).toBeLessThanOrEqual(
    viewport!.width,
  );
  expect(box.y + box.height, `${label} should not sit below the viewport`).toBeLessThanOrEqual(
    viewport!.height,
  );
}

async function expectNoPageHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rootOverflow = document.documentElement.scrollWidth - window.innerWidth;
        const bodyOverflow = document.body.scrollWidth - window.innerWidth;
        return Math.max(rootOverflow, bodyOverflow);
      }),
    )
    .toBeLessThanOrEqual(1);
}

async function expectPrimaryActions(page: Page): Promise<void> {
  const toolbar = page.locator(".venueSheetStickyBar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute("role", "toolbar");
  await expect(toolbar).toHaveAttribute("aria-label", "Venue actions");
  await expectInViewport(toolbar, "Venue actions toolbar", page);

  const actions = await toolbar.locator("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "unnamed action",
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }),
  );

  expect(actions.map((action) => action.name)).toEqual([
    "Add a price at Arnos Arms",
    "Crawl",
    "Share Arnos Arms",
  ]);

  for (const action of actions) {
    expect(action.width, `${action.name} width should be at least 44px`).toBeGreaterThanOrEqual(44);
    expect(action.height, `${action.name} height should be at least 44px`).toBeGreaterThanOrEqual(
      44,
    );
    expect(action.x, `${action.name} should not sit off the left edge`).toBeGreaterThanOrEqual(0);
    expect(action.y, `${action.name} should not sit above the viewport`).toBeGreaterThanOrEqual(0);
    expect(action.x + action.width, `${action.name} should not sit off the right edge`).toBeLessThanOrEqual(
      VIEWPORT.width,
    );
    expect(action.y + action.height, `${action.name} should not sit below the viewport`).toBeLessThanOrEqual(
      VIEWPORT.height,
    );
  }
}

test("mobile venue sheet tabs remain tappable and keep primary controls reachable", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/sheet-half/);

  const closeButton = portal.getByRole("button", { name: "Close pub detail" });
  await expectTapTarget(closeButton, "venue sheet close button");
  // Read the shipped size rather than restate it: this line used to carry a
  // literal 18, and it went red when the shared affordance moved to 19 with
  // nothing about the control having actually broken.
  await expect(closeButton.locator("svg")).toHaveAttribute(
    "width",
    String(SURFACE_NAV_HOME_ICON_SIZE),
  );

  const tablist = portal.getByRole("tablist", { name: "Venue detail sections" });
  await expect(tablist).toBeVisible();
  await expectNoPageHorizontalOverflow(page);

  await expect(tablist.getByRole("tab")).toHaveCount(TABS.length);
  const overviewMore = portal.locator("details.venueOverviewMore");
  await expect(overviewMore).not.toHaveAttribute("open", "");
  await expect(
    overviewMore.getByText("Details and practical info", { exact: true }),
  ).toBeVisible();
  await expect(overviewMore.locator(".venueOverviewMoreBody")).toBeHidden();
  // The price ENTRY POINT is reachable, in whichever form this session earns
  // and wherever the phone puts it. Two things had to be widened here: the
  // inline form only mounts for an account that may submit, so asserting it
  // outright made this line depend on whether the run had auth configured; and
  // the command bar deliberately LEAVES this panel on a phone for the shared
  // sheet footer, so scoping the search to the portal missed it. This line sat
  // unreachable behind the icon assertion above for long enough that neither
  // showed up.
  const inlinePriceForm = portal.locator(".venuePriceSubmit");
  const addPriceCommand = page.getByRole("button", { name: /add price/i });
  await expect
    .poll(async () => (await inlinePriceForm.count()) + (await addPriceCommand.count()))
    .toBeGreaterThan(0);

  for (const { label, panelId } of TABS) {
    const tab = tablist.getByRole("tab", { name: label, exact: true });
    await expectTapTarget(tab, `${label} tab`);
    await tab.click();

    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(portal.locator(`#${panelId}`)).toBeVisible();
    // The overview intentionally stays at the readable half snap on mobile.
    // The content tabs below are the regression surface: switching among them
    // should expand the sheet and keep the primary command bar reachable.
    if (label === "Overview") {
      await expect(sheet).toHaveClass(/sheet-half/);
    } else {
      await expect(sheet).toHaveClass(/sheet-full/);
      await expectPrimaryActions(page);
    }
    await expectNoPageHorizontalOverflow(page);
  }
});
