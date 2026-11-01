import { expect, test, type Locator, type Page } from "@playwright/test";

import { SURFACE_NAV_HOME_ICON_SIZE } from "@/components/ui/surface-nav";

import { routeHygieneBadge } from "./helpers/hygieneBadge";
import { routeLateVenueRows } from "./helpers/lateVenueRows";
import { openOverviewFold } from "./helpers/overviewFolds";
import { OVERVIEW_FOLDS } from "@/lib/venueOverviewFolds";

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

test.use({
  viewport: VIEWPORT,
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
});

const TABS: ReadonlyArray<{ label: string; panelId: string }> = [
  { label: "Overview", panelId: "venuePanel-overview" },
  { label: "Photos", panelId: "venuePanel-photos" },
  { label: "Menu", panelId: "venuePanel-menu" },
  { label: "Prices", panelId: "venuePanel-pints" },
  { label: "Lore", panelId: "venuePanel-story" },
];

test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
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

async function openTouchSession(page: Page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 1,
  });
  return session;
}

async function tapWithTouch(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box, "touch target should have a box").not.toBeNull();

  const session = await openTouchSession(page);
  const x = Math.round(box!.x + box!.width / 2);
  const y = Math.round(box!.y + box!.height / 2);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
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

  // The toolbar carries no price action: the Overview's one price door owns
  // that (lib/pintTrust.ts, `overviewPriceDoor`). It carries no plan action
  // either, in build mode too: the action card's ONE plan door, on the row
  // above it, owns those (lib/venuePlanDoor.ts).
  expect(actions.map((action) => action.name)).toEqual(["Ask Arnos Arms for a table", "Share Arnos Arms"]);
  const planDoors = page
    .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
    .getByRole("button", { name: /Stop 1$|^Plan stop$|^In plan$|crawl$|^Crawl$|^Remove$/ });
  await expect(planDoors).toHaveCount(1);
  await expect(planDoors).toHaveText("Make it Stop 1");

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
  // The Overview is five folds (lib/venueOverviewFolds.ts), in table order,
  // and only Price is open on arrival. Every summary is a thumb-sized row.
  const folds = portal.locator("#venuePanel-overview details.venueOverviewFold");
  await expect(folds).toHaveCount(OVERVIEW_FOLDS.length);
  for (const [index, fold] of OVERVIEW_FOLDS.entries()) {
    const rendered = folds.nth(index);
    await expect(rendered).toHaveAttribute("data-overview-fold", fold.key);
    const summary = rendered.locator(":scope > summary");
    await expect(summary.locator(".venueOverviewFoldLabel")).toHaveText(fold.label);
    if (fold.defaultOpen) {
      await expect(rendered).toHaveAttribute("open", "");
    } else {
      await expect(rendered).not.toHaveAttribute("open", "");
      await expect(rendered.locator(":scope > .venueOverviewFoldBody")).toBeHidden();
    }
    await expectTapTarget(summary, `${fold.label} fold`);
  }
  // The price ENTRY POINT is reachable: the Overview's ONE price door
  // (lib/pintTrust.ts, `overviewPriceDoor`), which folds the form behind it.
  // Its accessible name names the pub so a screen reader hears which one.
  const priceDoor = portal.locator("[data-price-door]");
  await expect(priceDoor).toHaveCount(1);
  await expect(priceDoor).toHaveAttribute("aria-label", /Arnos Arms/);

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

/**
 * The peek price plaque on the Drinks tab (L05 of the contribution battle test,
 * 5 September 2026, which read the plaque as cut at the top). The plaque is
 * TILTED, so its painted box overhangs its own layout row in proportion to its
 * width, and it used to stretch to the whole grid column: a £6.50 on a plate
 * three times its size, leaning into the divider drawn above it.
 */
test("the peek price plaque hugs its figure and stays inside its own row", async ({
  page,
}) => {
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);
  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const plaque = portal.locator(".mobileVenuePeekSummary .priceBadge").first();
  await expect(plaque).toBeVisible();

  await expect(async () => {
    await portal.locator("#venueTab-menu").click();
    await expect(portal.locator("#venuePanel-menu")).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });

  const geometry = await plaque.evaluate((element) => {
    const cell = element.parentElement as HTMLElement;
    // The plaque's frame: the action card in the sheet footer since the card
    // took the peek row (launch plan, 1 Nov 2026), else the scrolling body it
    // used to head. Either way nothing may cut the plaque at that top edge.
    const frame = (element.closest(".venueActionCard") ??
      element.closest(".mobileSharedSheetBody")) as HTMLElement | null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const box = element.getBoundingClientRect();
    const figure = range.getBoundingClientRect();
    const cellBox = cell.getBoundingClientRect();
    const frameBox = frame?.getBoundingClientRect();
    return {
      width: box.width,
      figureWidth: figure.width,
      paintedAboveRow: cellBox.top - box.top,
      clearanceUnderFrameTop: frameBox ? box.top - frameBox.top : null,
    };
  });

  // The plate is the figure plus the plaque's own padding, never the column.
  expect(geometry.width).toBeLessThan(geometry.figureWidth * 2.2);
  // Nothing of the plaque is painted above its own layout row, so it cannot
  // reach the hairline the peek row draws over it. The -1.5deg tilt that used
  // to put a fraction of a pixel up there is retired (captain 6 Sep 2026).
  expect(geometry.paintedAboveRow).toBeLessThan(1.5);
  expect(geometry.clearanceUnderFrameTop, "the plaque has a frame").not.toBeNull();
  expect(geometry.clearanceUnderFrameTop ?? 0).toBeGreaterThan(4);
});

/**
 * The peek head is three cells and the middle one is a PROMPT, not a heading.
 *
 * PlanAstra measured the Sir Christopher Hatton at 390 (light and dark): the
 * standing line "Logged once, needs a second drinker" ran the full width of the
 * figure column, the phrase column had no floor of its own, and "Near me" -
 * one unbreakable phrase - overflowed its cell and printed as "Near m" under
 * the peek's plan door (then `Plan stop`; with no crawl it is now
 * `Make it Stop 1`, the longest label it carries). The caption is set here
 * rather than hunted for, because the contract is about caption LENGTH and the
 * pub a fixture opens on is not the pub that carries the longest one.
 */
for (const width of [320, 390] as const) {
  test(`the peek head keeps Near me whole beside the longest standing line @${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    expect(response?.status()).toBe(200);

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(portal).toBeVisible();
    const peek = portal.locator(".mobileVenuePeekSummary");
    await expect(peek).toBeVisible();
    const nearMe = peek.locator(".mobileVenuePeekNearMe");
    await expect(nearMe).toBeVisible();

    const geometry = await peek.evaluate((row) => {
      const caption = row.querySelector<HTMLElement>(":scope > span:first-child small");
      if (caption) caption.textContent = "Logged once, needs a second drinker";
      const phrase = row.querySelector<HTMLElement>(".mobileVenuePeekNearMe")!;
      const phraseCell = phrase.parentElement as HTMLElement;
      const action = row.querySelector<HTMLElement>(":scope > button");
      const box = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      };
      const range = document.createRange();
      range.selectNodeContents(phrase);
      return {
        phrase: box(phrase),
        phraseText: box(range),
        phraseCell: box(phraseCell),
        action: action ? box(action) : null,
        rowRight: box(row).right,
        // A prompt may not print at the FIGURES size. That size is --text-md,
        // which is what this cell prints when it carries a walk time, so the
        // reference is the resolved token rather than a literal: the assertion
        // then survives a change to the scale. It is resolved through a probe
        // because the plaque beside it wears a smaller face of its own.
        phraseFontPx: Number.parseFloat(getComputedStyle(phrase).fontSize),
        figureFontPx: (() => {
          const probe = document.createElement("span");
          probe.style.fontSize = "var(--text-md)";
          row.appendChild(probe);
          const size = Number.parseFloat(getComputedStyle(probe).fontSize);
          probe.remove();
          return size;
        })(),
      };
    });

    // The phrase is inside its own cell, and its cell is inside the row.
    expect(geometry.phraseText.right).toBeLessThanOrEqual(geometry.phraseCell.right + 0.5);
    expect(geometry.phraseCell.right).toBeLessThanOrEqual(geometry.rowRight + 0.5);
    // Nothing is drawn over it. The action is the control that used to be.
    if (geometry.action) {
      expect(geometry.phraseText.right).toBeLessThanOrEqual(geometry.action.left + 0.5);
    }
    // "Near me" is a location prompt, so it prints BELOW the figures size the
    // walk time it stands in for uses. Strictly below: equal is the defect.
    expect(geometry.phraseFontPx).toBeLessThan(geometry.figureFontPx);
    await expectNoPageHorizontalOverflow(page);
  });
}

/**
 * ONE ROW, EVERY TAB ONE TAP AWAY (site audit 13 Sep 2026, D10). Seven tabs
 * wrapped into two rows on a 390px phone (rows at y=556 and y=602, a 98px
 * strip); before that a sideways strip hid the last tabs past the edge. Five
 * tabs share one row: the same top, every tab inside the rail, every label
 * centred in its own tab and uncut, no scroll, no fade. Measured with the DOM,
 * because an off-centre label is a defect and eyes round it away.
 */
for (const width of [320, 390, 430] as const) {
  test(`every venue tab sits in one row inside the sheet @${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    expect(response?.status()).toBe(200);

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(portal).toBeVisible();
    const tablist = portal.getByRole("tablist", { name: "Venue detail sections" });
    await expect(tablist).toBeVisible();
    await expect(tablist.getByRole("tab")).toHaveCount(TABS.length);

    const geometry = await tablist.evaluate((rail) => {
      const railBox = rail.getBoundingClientRect();
      const tabs = Array.from(rail.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) => {
        const box = tab.getBoundingClientRect();
        const label = Array.from(tab.children).find(
          (child) => getComputedStyle(child).display !== "none",
        ) as HTMLElement | undefined;
        const range = document.createRange();
        if (label) range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        return {
          name: tab.getAttribute("aria-label") ?? "",
          top: box.top,
          left: box.left,
          right: box.right,
          width: box.width,
          height: box.height,
          textLeft: text.left,
          textRight: text.right,
          labelScrollWidth: label?.scrollWidth ?? 0,
          labelClientWidth: label?.clientWidth ?? 0,
        };
      });
      return {
        rail: { left: railBox.left, right: railBox.right, height: railBox.height },
        scrollWidth: rail.scrollWidth,
        clientWidth: rail.clientWidth,
        tabs,
      };
    });

    const firstTop = geometry.tabs[0].top;
    for (const tab of geometry.tabs) {
      expect(Math.abs(tab.top - firstTop), `${tab.name} shares the first row`).toBeLessThanOrEqual(0.5);
      expect(tab.left, `${tab.name} starts inside the rail`).toBeGreaterThanOrEqual(geometry.rail.left - 0.5);
      expect(tab.right, `${tab.name} ends inside the rail`).toBeLessThanOrEqual(geometry.rail.right + 0.5);
      expect(tab.height, `${tab.name} height`).toBeGreaterThanOrEqual(44);
      expect(tab.width, `${tab.name} width`).toBeGreaterThanOrEqual(44);
      expect(tab.textLeft, `${tab.name} label is not cut on the left`).toBeGreaterThanOrEqual(tab.left);
      expect(tab.textRight, `${tab.name} label is not cut on the right`).toBeLessThanOrEqual(tab.right);
      const labelCentre = (tab.textLeft + tab.textRight) / 2;
      const tabCentre = (tab.left + tab.right) / 2;
      expect(Math.abs(labelCentre - tabCentre), `${tab.name} label is centred`).toBeLessThanOrEqual(1);
    }
    // One row: the rail is one tab tall plus its own padding, never two.
    expect(geometry.rail.height).toBeLessThan(geometry.tabs[0].height * 2);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    await expect(tablist).toHaveAttribute("data-trailing-fade", "off");

    const lastTab = tablist.getByRole("tab", { name: TABS[TABS.length - 1].label, exact: true });
    await tapWithTouch(page, lastTab);
    await expect(lastTab).toHaveAttribute("aria-selected", "true");
    await expect(portal.locator(`#${TABS[TABS.length - 1].panelId}`)).toBeVisible();
    await expectNoPageHorizontalOverflow(page);
  });
}

/**
 * The two retired tabs are sections now, and each is still one tap from the
 * sheet: the getting-home fold on the Overview, and Ask inside Lore.
 */
test("the getting-home fold and Ask are one tap from their tabs", async ({ page }) => {
  // The wait below needs the hygiene row, so it may not hang on the live FSA service.
  await routeHygieneBadge(page);
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const overview = portal.locator("#venuePanel-overview");
  await expect(overview).toBeVisible();

  // The Overview rows that land after their own reads (the area price line
  // and the food hygiene rating) arrive three to five seconds after the sheet
  // opens on a slow runner. Wait for both, so nothing in the Overview is still
  // landing when the tap goes in. The hygiene rating lives in "The pub".
  await expect(overview.locator(".venueAreaPriceCompare")).toBeVisible({ timeout: 20_000 });
  await openOverviewFold(overview, "pub");
  await expect(overview.locator(".venueHygiene")).toBeVisible({ timeout: 20_000 });
  // The getting-home fold sits inside "Getting there and home", and keeps its
  // own "Last train" summary there.
  await openOverviewFold(overview, "journey");
  const fold = overview.locator("#venueSection-getting-home");
  const summary = fold.locator(":scope > summary");
  await expect(summary).toHaveText("Last train");
  await expect(fold).not.toHaveAttribute("open", "");
  await summary.scrollIntoViewIfNeeded();
  await expectTapTarget(summary, "Last train fold");
  // The sheet keeps changing height after it opens (the command bar lands in
  // its footer and the sheet re-caps), so the fold can move between the
  // click's hit test and the press, and the tap lands beside it. Wait for the
  // sheet to rest, then retry the tap until the fold opens. The tap is only
  // repeated while the fold is still shut, so a slow toggle is never undone.
  const sheet = portal.locator(".mobileSharedSheet");
  await expect(sheet).toHaveAttribute("data-sheet-motion", "idle");
  await expect(async () => {
    if ((await fold.getAttribute("open")) === null) await summary.click();
    await expect(fold).toHaveAttribute("open", "", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(fold.getByLabel("Last Pint")).toBeVisible();

  await portal.getByRole("tab", { name: "Lore", exact: true }).click();
  const ask = portal.locator("#venuePanel-story #venueSection-ask");
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: /Tell me about this/ })).toBeVisible();
});

/**
 * The Overview rows that render only after their own read answers (the Spoons
 * value row, "What it used to cost" and the area price line) land at the FOOT
 * of the Price fold, under the one price door, so the door does not move under
 * a finger once it is painted. The food hygiene rating lands in "The pub",
 * which is shut on arrival, so it moves nothing at all.
 */
test("the price door stays put while the late Overview rows land", async ({ page }) => {
  // The pin needs every late row to land. The hygiene row may not hang on the
  // live FSA service, and Arnos Arms is neither a ranked Wetherspoons nor a pub
  // with a dated history price, so it borrows real answers for both.
  await routeHygieneBadge(page);
  await routeLateVenueRows(page, ARNOS_ARMS_ID, "Arnos Arms");
  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
  expect(response?.status()).toBe(200);

  const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(portal).toBeVisible();
  const overview = portal.locator("#venuePanel-overview");
  await expect(overview).toBeVisible();
  const door = overview.locator("#venueFold-price [data-price-door]");
  await expect(door).toBeVisible();
  // Measured against the panel, so scrolling the sheet does not move it.
  const offset = (target: Locator) =>
    target.evaluate((element) => {
      const panel = element.closest("#venuePanel-overview");
      return Math.round(element.getBoundingClientRect().top - (panel?.getBoundingClientRect().top ?? 0));
    });
  const before = await offset(door);

  const priceFold = overview.locator("#venueFold-price");
  const lateRows = [
    priceFold.locator(".venueSpoonsValue"),
    priceFold.locator(".venuePriceThen"),
    priceFold.locator(".venueAreaPriceCompare"),
  ];
  for (const row of lateRows) await expect(row).toBeVisible({ timeout: 20_000 });

  expect(await offset(door), "the price door did not move").toBe(before);
  for (const row of lateRows) expect(await offset(row)).toBeGreaterThan(before);
  // The hygiene rating is in "The pub", out of the price area altogether.
  await expect(overview.locator("#venueFold-pub .venueHygiene")).toBeAttached({ timeout: 20_000 });
});
