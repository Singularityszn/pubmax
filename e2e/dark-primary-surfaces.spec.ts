import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const CSS = [
  "app/globals.css",
  "app/theme.css",
  "components/landing/landing.css",
  "components/city/cityChooser.css",
  "components/map/tonightArcChips.css",
  "components/map/venueSheet.css",
  "components/map/venuePriceSubmit.css",
  "components/mobile/mobileMapShell.css",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

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

function gradientColours(backgroundImage: string): Rgba[] {
  return (
    backgroundImage.match(
      /(?:rgb|color\(srgb)[^(]*(?:\([^)]*\)|\([^)]*\))/g,
    ) ?? []
  ).map(parseColour);
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
): Promise<PaintState> {
  const colour = await colourLocator.evaluate(
    (node, pseudoElement) => getComputedStyle(node, pseudoElement).color,
    pseudo,
  );
  return surfaceLocator.evaluate((node, foregroundColour) => {
    const style = getComputedStyle(node);
    const ancestorBackgrounds: string[] = [];
    let ancestor = node.parentElement;
    while (ancestor) {
      ancestorBackgrounds.push(getComputedStyle(ancestor).backgroundColor);
      ancestor = ancestor.parentElement;
    }
    return {
      colour: foregroundColour,
      opacity: Number(style.opacity),
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      ancestorBackgrounds,
    };
  }, colour);
}

function renderedContrastRatios(
  state: PaintState,
  background: "solid" | "gradient" = "solid",
): number[] {
  const foreground = parseColour(state.colour);
  const backdrop = resolveBackdrop(state.ancestorBackgrounds);
  const surfaceColour = parseColour(state.backgroundColour);
  const surfaceBase = composite(surfaceColour, backdrop);
  const paintedBackgrounds =
    background === "gradient"
      ? gradientColours(state.backgroundImage).map((stop) =>
          composite(stop, surfaceBase),
        )
      : [surfaceBase];

  return paintedBackgrounds.map((paintedBackground) => {
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
  });
}

async function expectRenderedTextContrast(
  colourLocator: Locator,
  options: {
    background?: "solid" | "gradient";
    minimum?: number;
    pseudo?: "::placeholder";
    surfaceLocator?: Locator;
  } = {},
): Promise<number> {
  const state = await readPaintState(
    colourLocator,
    options.surfaceLocator,
    options.pseudo,
  );
  const ratios = renderedContrastRatios(state, options.background);
  expect(ratios.length).toBeGreaterThan(0);
  const minimumRatio = Math.min(...ratios);
  expect(
    minimumRatio,
    `Rendered contrast for ${await colourLocator.evaluate((node) => node.className)} from ${JSON.stringify(state)}`,
  ).toBeGreaterThanOrEqual(options.minimum ?? 4.5);
  return minimumRatio;
}

async function prepareDarkSurfaces(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(`
    <!doctype html>
    <html data-theme="dark">
    <head>
      <style>
        ${CSS}
        body { margin: 0; padding: 16px; }
        .surfaceFixture { display: grid; gap: 18px; }
        .surfaceFixture > section { background: var(--paper); }
      </style>
    </head>
    <body>
      <main class="surfaceFixture">
      <section class="lp">
        <nav class="lpNav">
          <a class="lpWordmark" href="#">PUBMAXXING</a>
        </nav>
        <a class="lpButton lpButtonPrimary" href="#">Find my pint</a>
        <div class="cityChooser cityChooser--section">
          <div class="cityChooserSearchField">
            <span aria-hidden="true">⌕</span>
            <input
              class="cityChooserSearchInput"
              placeholder="Try Sheffield or your town"
            />
          </div>
        </div>
      </section>
      <section class="appShell">
        <div class="tonightArcChips">
          <button class="tonightArcChip isOn">Pints</button>
          <button class="tonightArcChip" disabled>Clubs</button>
        </div>
        <aside class="mobileSharedSheet mapDrawer">
          <div class="venueTabs">
            <button class="venueTab active">Overview</button>
            <button class="venueTab">Drinks</button>
          </div>
          <div class="vpsubPriceRow">
            <input class="vpsubInput" placeholder="4.20" />
          </div>
          <button class="venueSheetStickyPrimary">Add price</button>
          <button class="vpsubLog" disabled>Log it</button>
        </aside>
      </section>
      </main>
    </body>
    </html>
  `);
}

for (const viewport of VIEWPORTS) {
  test(`dark primary surfaces meet their state contracts at ${viewport.width}px`, async ({
    page,
  }) => {
    await prepareDarkSurfaces(page, viewport);

    await expectRenderedTextContrast(page.locator(".lpButtonPrimary"));
    await expectRenderedTextContrast(page.locator(".tonightArcChip.isOn"));
    await expectRenderedTextContrast(page.locator(".venueTab.active"), {
      background: "gradient",
    });
    await expectRenderedTextContrast(page.locator(".venueSheetStickyPrimary"), {
      background: "gradient",
    });

    const landingMaterial = await page.locator(".lpNav").evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter,
        borderColour: style.borderColor,
      };
    });
    expect(landingMaterial.backgroundImage).toBe("none");
    expect(landingMaterial.backdropFilter).toBe("none");

    for (const selector of [".cityChooserSearchInput", ".vpsubInput"]) {
      const input = page.locator(selector);
      const surface =
        selector === ".cityChooserSearchInput"
          ? page.locator(".cityChooserSearchField")
          : page.locator(".vpsubPriceRow");
      await expectRenderedTextContrast(input, {
        pseudo: "::placeholder",
        surfaceLocator: surface,
      });
    }

    for (const selector of [".tonightArcChip:disabled", ".vpsubLog:disabled"]) {
      await expectRenderedTextContrast(page.locator(selector));
    }

    const activeTab = page.locator(".venueTab.active");
    await activeTab.focus();
    const focusState = await activeTab.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outline: style.outlineStyle,
        outlineColour: style.outlineColor,
      };
    });
    expect(focusState.outline).not.toBe("none");
    const sheetPaint = await readPaintState(page.locator(".mobileSharedSheet"));
    const sheetBackground = composite(
      parseColour(sheetPaint.backgroundColour),
      resolveBackdrop(sheetPaint.ancestorBackgrounds),
    );
    expect(
      contrastRatio(parseColour(focusState.outlineColour), sheetBackground),
    ).toBeGreaterThanOrEqual(3);

    await page.locator(".venueTab:not(.active)").hover();
    await expectRenderedTextContrast(page.locator(".venueTab:not(.active)"));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
