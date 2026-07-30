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

async function expectAaText(
  locator: Locator,
  background: "solid" | "gradient" = "solid",
): Promise<void> {
  const computed = await locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      colour: style.color,
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
    };
  });

  const foreground = parseColour(computed.colour);
  const backgrounds =
    background === "gradient"
      ? gradientColours(computed.backgroundImage)
      : [parseColour(computed.backgroundColour)];

  expect(backgrounds.length).toBeGreaterThan(0);
  for (const paintedBackground of backgrounds) {
    expect(
      contrastRatio(
        foreground[3] < 1
          ? composite(foreground, paintedBackground)
          : foreground,
        paintedBackground,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  }
}

async function prepareDarkSurfaces(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(`
    <style>
      ${CSS}
      body { margin: 0; padding: 16px; }
      .surfaceFixture { display: grid; gap: 18px; }
    </style>
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
  `);
  await page.locator("html").evaluate((html) => {
    html.dataset.theme = "dark";
  });
}

for (const viewport of VIEWPORTS) {
  test(`dark primary surfaces meet their state contracts at ${viewport.width}px`, async ({
    page,
  }) => {
    await prepareDarkSurfaces(page, viewport);

    await expectAaText(page.locator(".lpButtonPrimary"));
    await expectAaText(page.locator(".tonightArcChip.isOn"));
    await expectAaText(page.locator(".venueTab.active"), "gradient");
    await expectAaText(page.locator(".venueSheetStickyPrimary"), "gradient");

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
      const placeholder = await page.locator(selector).evaluate((node) => {
        const field = node.closest(".cityChooserSearchField");
        const backgroundNode = field ?? node.parentElement;
        return {
          colour: getComputedStyle(node, "::placeholder").color,
          background: getComputedStyle(backgroundNode!).backgroundColor,
        };
      });
      const placeholderBackground = parseColour(placeholder.background);
      expect(
        contrastRatio(
          composite(parseColour(placeholder.colour), placeholderBackground),
          placeholderBackground,
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }

    const disabled = page.locator(".tonightArcChip:disabled");
    const disabledState = await disabled.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        opacity: Number(style.opacity),
        colour: style.color,
        background: style.backgroundColor,
      };
    });
    expect(disabledState.opacity).toBeGreaterThanOrEqual(0.4);
    expect(
      contrastRatio(
        parseColour(disabledState.colour),
        parseColour(disabledState.background),
      ),
    ).toBeGreaterThanOrEqual(4.5);

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
    expect(
      contrastRatio(
        parseColour(focusState.outlineColour),
        parseColour("rgb(32, 32, 36)"),
      ),
    ).toBeGreaterThanOrEqual(3);

    await page.locator(".venueTab:not(.active)").hover();
    await expect(page.locator(".venueTab:not(.active)")).toHaveCSS(
      "color",
      "rgb(238, 243, 239)",
    );

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
