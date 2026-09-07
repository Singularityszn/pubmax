import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const ARNOS_ARMS_ID = "venue-xjf3n0";
const LONG_QUERY = `The ${"Extremely Long User Entered Pub Identity ".repeat(14)}`;
const LONG_STATUS_HEADLINE =
  "Major disruption across central London. Several routes are diverted while emergency works continue, replacement services are limited, and travellers should allow extra time before setting off.";

type Rgba = [number, number, number, number];

type PaintState = {
  colour: string;
  opacity: number;
  backgroundColour: string;
  backgroundImage: string;
  ancestorBackgrounds: string[];
};

function parseColour(value: string): Rgba {
  const channels = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse colour: ${value}`);
  }

  if (value.startsWith("color(srgb")) {
    return [
      channels[0] * 255,
      channels[1] * 255,
      channels[2] * 255,
      channels[3] ?? 1,
    ];
  }

  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    (foreground[0] * foreground[3] +
      background[0] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[1] * foreground[3] +
      background[1] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[2] * foreground[3] +
      background[2] * background[3] * (1 - foreground[3])) /
      alpha,
    alpha,
  ];
}

function relativeLuminance(colour: Rgba): number {
  const channels = colour.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function withAlpha(colour: Rgba, alpha: number): Rgba {
  return [colour[0], colour[1], colour[2], alpha];
}

function resolveBackdrop(ancestorBackgrounds: string[]): Rgba {
  return ancestorBackgrounds
    .map(parseColour)
    .reverse()
    .reduce<Rgba>(
      (background, foreground) => composite(foreground, background),
      [255, 255, 255, 1],
    );
}

async function readPaintState(
  colourLocator: Locator,
  surfaceLocator: Locator = colourLocator,
  pseudo?: "::placeholder",
  surfacePseudo?: "::before",
): Promise<PaintState> {
  const colour = await colourLocator.evaluate(
    (node, pseudoElement) => getComputedStyle(node, pseudoElement).color,
    pseudo,
  );
  return surfaceLocator.evaluate((node, input) => {
    const style = getComputedStyle(node, input.surfacePseudo);
    const ancestorBackgrounds: string[] = [];
    let ancestor = node.parentElement;
    while (ancestor) {
      ancestorBackgrounds.push(getComputedStyle(ancestor).backgroundColor);
      ancestor = ancestor.parentElement;
    }
    return {
      colour: input.foregroundColour,
      opacity: Number(style.opacity),
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      ancestorBackgrounds,
    };
  }, { foregroundColour: colour, surfacePseudo });
}

function renderedContrastRatio(state: PaintState): number {
  const foreground = parseColour(state.colour);
  const backdrop = resolveBackdrop(state.ancestorBackgrounds);
  const paintedBackground = composite(parseColour(state.backgroundColour), backdrop);
  const localForeground = composite(foreground, paintedBackground);
  const renderedForeground = composite(
    withAlpha(localForeground, state.opacity),
    backdrop,
  );
  const renderedBackground = composite(
    withAlpha(paintedBackground, state.opacity),
    backdrop,
  );
  return contrastRatio(renderedForeground, renderedBackground);
}

async function expectRenderedTextContrast(
  colourLocator: Locator,
  options: {
    minimum?: number;
    pseudo?: "::placeholder";
    surfaceLocator?: Locator;
    surfacePseudo?: "::before";
  } = {},
): Promise<number> {
  await expect(colourLocator).toBeVisible();
  const state = await readPaintState(
    colourLocator,
    options.surfaceLocator,
    options.pseudo,
    options.surfacePseudo,
  );
  expect(state.backgroundImage).toBe("none");
  const minimumRatio = renderedContrastRatio(state);
  expect(
    minimumRatio,
    `Rendered contrast for ${await colourLocator.evaluate((node) => node.className)} from ${JSON.stringify(state)}`,
  ).toBeGreaterThanOrEqual(options.minimum ?? 4.5);
  return minimumRatio;
}

async function prepareDarkRoutes(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-30T18:00:00.000Z",
        weather: null,
        tubeLines: [],
        signals: [],
      }),
    }),
  );
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-07-30T18:00:00.000Z",
      }),
    }),
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("receipt control contrast", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    storageState: { cookies: [], origins: [] },
  });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme} receipt control keeps text, border and focus legible`, async ({
      page,
    }, testInfo) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("pubmax-theme", selectedTheme);
        localStorage.setItem("pubmax-tour-v1-done", "1");
        localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
        localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
        sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      }, theme);
      await installDeterministicMapBasemap(page);
      await page.goto("/map?sel=venue-eltcmh&log=1&price=6.50", {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

      const control = page.getByTestId("spill-receipt-step").locator(".spillCameraBtn.primary");
      await expect(control).toBeVisible();
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });

      const measure = async (state: string) => {
        const paint = await readPaintState(control);
        const edges = await control.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            border: style.borderTopColor,
            outline: style.outlineColor,
            outlineStyle: style.outlineStyle,
            outlineWidth: Number.parseFloat(style.outlineWidth),
            fontSize: style.fontSize,
          };
        });
        const box = await control.boundingBox();
        expect(box).not.toBeNull();
        const screenshot = await page.screenshot({
          path: testInfo.outputPath(`receipt-${theme}-${state}.png`),
        });
        const pixels = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const scale = pixels.info.width / 390;
        const sample = (x: number, y: number): Rgba => {
          const offset = (
            Math.floor(y * scale) * pixels.info.width + Math.floor(x * scale)
          ) * pixels.info.channels;
          return [pixels.data[offset], pixels.data[offset + 1], pixels.data[offset + 2], 1];
        };
        // The sheet is translucent over a canvas and a sibling scrim. Sample
        // empty painted areas because CSS ancestors alone omit both layers.
        const background = sample(box!.x + 12, box!.y + box!.height / 2);
        const surroundings = sample(box!.x + box!.width / 2, box!.y - 6);
        return {
          paint,
          edges,
          background,
          surroundings,
          textContrast: contrastRatio(composite(parseColour(paint.colour), background), background),
          borderContrast: contrastRatio(composite(parseColour(edges.border), background), background),
          borderSurroundingContrast: contrastRatio(composite(parseColour(edges.border), surroundings), surroundings),
          outlineContrast: contrastRatio(composite(parseColour(edges.outline), surroundings), surroundings),
        };
      };

      const resting = await measure("resting");
      await control.hover();
      const hovered = await measure("hover");
      const picker = control.locator('input[type="file"]');
      await picker.focus();
      await expect(picker).toBeFocused();
      const focused = await measure("focus");
      await testInfo.attach("receipt-control-paint", {
        contentType: "application/json",
        body: JSON.stringify({ theme, resting, hovered, focused }, null, 2),
      });

      for (const [state, measurement] of Object.entries({ resting, hovered, focused })) {
        expect(measurement.paint.backgroundImage, `${state} has a measurable flat fill`).toBe("none");
        expect(measurement.paint.backgroundColour, `${state} preserves the fill`).toBe(resting.paint.backgroundColour);
        expect.soft(measurement.textContrast, `${theme} ${state} text`).toBeGreaterThanOrEqual(4.5);
        expect.soft(measurement.borderContrast, `${theme} ${state} control edge`).toBeGreaterThanOrEqual(3);
        expect.soft(measurement.borderSurroundingContrast, `${theme} ${state} edge against its surroundings`).toBeGreaterThanOrEqual(3);
      }
      expect(hovered.edges.border, "hover changes the visible control edge").not.toBe(resting.edges.border);
      expect(focused.edges.outlineStyle).toBe("solid");
      expect(focused.edges.outlineWidth).toBeGreaterThanOrEqual(2);
      expect.soft(focused.outlineContrast, `${theme} focus ring against its surroundings`).toBeGreaterThanOrEqual(3);
    });
  }
});

for (const viewport of VIEWPORTS) {
  test(`dark production landing, map, and venue sheet meet state contracts at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await prepareDarkRoutes(page, viewport);
    const measurements: Record<string, number> = {};

    const landingResponse = await page.goto("/");
    expect(landingResponse?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    measurements.landingPrimary = await expectRenderedTextContrast(
      page.locator(".lpHero [data-primary-action] a").first(),
    );
    const landingMaterial = await page.locator(".lpNav").evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter,
      };
    });
    expect(landingMaterial.backgroundImage).toBe("none");
    expect(landingMaterial.backdropFilter).toBe("none");

    const cityInput = page.locator(".cityChooserSearchInput");
    await cityInput.scrollIntoViewIfNeeded();
    measurements.landingPlaceholder = await expectRenderedTextContrast(cityInput, {
      pseudo: "::placeholder",
      surfaceLocator: page.locator(".cityChooserSearchField"),
    });
    await expectNoHorizontalOverflow(page);

    const mapResponse = await page.goto("/map");
    expect(mapResponse?.status()).toBe(200);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The venue-type chips are read in the Filters sheet on a phone (design
    // judgement 2026-08-01, finding 2.3), so that is where their contrast is
    // measured.
    await page
      .locator(".mobileMapTopbar")
      .getByRole("button", { name: /^Filters/ })
      .click();
    const filtersSheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]',
    );
    await expect(filtersSheet).toBeVisible({ timeout: 45_000 });
    // The sheet SHELL paints before its content: the venue types arrive a chunk
    // later. Measuring on the shell alone read zero colour pairs and failed on
    // "expected 0 to be greater than 0", which names the timing badly.
    await expect(
      filtersSheet.getByRole("group", { name: "Venue types" }),
    ).toBeVisible({ timeout: 45_000 });
    measurements.mapActiveChip = await expectRenderedTextContrast(
      filtersSheet.locator(".tonightArcChip.isOn").first(),
    );
    // There is no disabled venue-type chip left to measure: `Clubs` was the
    // only one and it is deleted (walk finding B9), so its contrast row goes
    // with it rather than being pointed at a control that no longer exists.
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);

    const sheetResponse = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    expect(sheetResponse?.status()).toBe(200);
    const sheet = page.locator(".mobileSharedSheet.right");
    await expect(sheet).toBeVisible({ timeout: 45_000 });
    await expect(sheet.locator(".venueInspector")).toContainText("Arnos Arms", {
      timeout: 45_000,
    });
    measurements.sheetPricePlaque = await expectRenderedTextContrast(
      sheet.locator(".mobileVenuePeekSummary .priceBadge"),
    );

    const activeTab = sheet.locator(".venueTab.active");
    measurements.sheetActiveTab = await expectRenderedTextContrast(activeTab);
    // The sheet's one painted primary is the Overview's price door
    // (lib/pintTrust.ts, `overviewPriceDoor`), flat like every other primary.
    // It arrives with the venue's price read rather than with the sheet, and
    // measuring before it paints returns no colour pairs at all, which reports
    // as "expected 0 to be greater than 0" and names the timing badly.
    const sheetPrimary = sheet.locator("[data-price-door]");
    await expect(sheetPrimary).toBeVisible({ timeout: 45_000 });
    measurements.sheetPrimary = await expectRenderedTextContrast(sheetPrimary);

    await activeTab.focus();
    const focusState = await activeTab.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outline: style.outlineStyle,
        outlineColour: style.outlineColor,
      };
    });
    expect(focusState.outline).not.toBe("none");
    const focusedTabPaint = await readPaintState(activeTab);
    const focusedTabBackground = composite(
      parseColour(focusedTabPaint.backgroundColour),
      resolveBackdrop(focusedTabPaint.ancestorBackgrounds),
    );
    measurements.sheetFocusOutline = contrastRatio(
      parseColour(focusState.outlineColour),
      focusedTabBackground,
    );
    expect(
      measurements.sheetFocusOutline,
      `Inset focus ring ${JSON.stringify({ focusState, focusedTabPaint })}`,
    ).toBeGreaterThanOrEqual(3);

    const inactiveTab = sheet.locator(".venueTab:not(.active)").first();
    await inactiveTab.hover();
    measurements.sheetHoverTab = await expectRenderedTextContrast(inactiveTab);

    await sheetPrimary.click();
    await expect(sheet.locator(".venuePriceSignInGate")).toBeVisible();
    await expect(sheet.locator(".venuePriceSubmit")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await testInfo.attach(`rendered-composited-contrast-${viewport.width}.json`, {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: "application/json",
    });
  });
}

test("bounds user-entered search identity while keeping fixed qualifiers visible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepareDarkRoutes(page, { width: 800, height: 800 });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const search = page.locator("#mapSearchInput");
  await expect(search).toBeVisible({ timeout: 45_000 });
  await search.fill(LONG_QUERY);

  const status = page.locator(".mapToolbarSearchStatus");
  await expect(status).toBeVisible();
  const query = status.locator(".mapToolbarSearchQuery");
  const qualifier = status.locator(".mapToolbarSearchQualifier");
  await expect(query).toHaveText(LONG_QUERY.trim());
  await expect(qualifier).toHaveText("’ with your current filters.");

  const queryGeometry = await query.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(queryGeometry.scrollWidth).toBeGreaterThan(queryGeometry.clientWidth);
  expect(queryGeometry.overflow).toBe("hidden");
  expect(queryGeometry.textOverflow).toBe("ellipsis");
  expect(queryGeometry.whiteSpace).toBe("nowrap");

  const [statusBox, qualifierBox] = await Promise.all([
    status.boundingBox(),
    qualifier.boundingBox(),
  ]);
  expect(statusBox).not.toBeNull();
  expect(qualifierBox).not.toBeNull();
  expect(qualifierBox!.x).toBeGreaterThanOrEqual(statusBox!.x);
  expect(qualifierBox!.x + qualifierBox!.width).toBeLessThanOrEqual(
    statusBox!.x + statusBox!.width + 1,
  );
});

test("expanded city-status sheet follows wrapped headline geometry", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 800, height: 800 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [] }),
    }),
  );
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-30T18:00:00.000Z",
        weather: null,
        tubeLines: [],
        signals: [
          {
            headline: LONG_STATUS_HEADLINE,
            detail: "Use another route where possible.",
            kind: "transport",
            severity: "major",
          },
        ],
      }),
    }),
  );

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const toggle = page.locator(".cityStatusBannerLink");
  await expect(toggle).toBeVisible({ timeout: 45_000 });
  await expect(toggle.locator(".cityStatusBannerCopy")).toHaveText(
    LONG_STATUS_HEADLINE,
  );
  await toggle.click();

  const banner = page.locator(".cityStatusBanner");
  const sheet = page.locator(".cityStatusSignalSheet");
  await expect(sheet).toBeVisible();
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const [bannerBox, sheetBox] = await Promise.all([
    banner.boundingBox(),
    sheet.boundingBox(),
  ]);
  expect(bannerBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.y).toBeGreaterThanOrEqual(
    bannerBox!.y + bannerBox!.height + 8,
  );
  expect(sheetBox!.height).toBeLessThan(260);
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(784);
});
