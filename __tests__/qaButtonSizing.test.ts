import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function declarations(css: string, selector: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) =>
      match[1].split(",").some((candidate) => candidate.trim() === selector),
    )
    .map(([, , body]) => body);
}

function minHeights(css: string, selector: string): number[] {
  return declarations(css, selector).flatMap((body) =>
    [...body.matchAll(/min-height\s*:\s*(\d+)px/g)].map(([, value]) => Number(value)),
  );
}

function expectMinHeight(css: string, selector: string) {
  expect(minHeights(css, selector), selector).toEqual(
    expect.arrayContaining([expect.any(Number)]),
  );
  expect(minHeights(css, selector).every((height) => height >= 44), selector).toBe(true);
}

describe("interactive control sizing audit", () => {
  it("keeps editorial links and venue provenance links at the tap floor", () => {
    const editorial = read("components/out/editorialRail.css");
    const venue = read("components/map/venueSheet.css");
    const globals = read("app/globals.css");
    const night = read("components/night/safeNightStrip.css");

    for (const [css, selector] of [
      [editorial, ".editorialRailLink"],
      [globals, ".priceSourceLink"],
      [venue, ".venueTabPanel .heritageFactCite"],
      [venue, ".venueTabPanel .placeStorySource"],
      [night, ".nightSafe__tel"],
      [night, ".nightSafe__link"],
    ] as const) {
      expectMinHeight(css, selector);
    }
  });

  it("keeps map camera, attribution, and map chrome controls at 44px", () => {
    const globals = read("app/globals.css");
    const toolbar = read("components/map/mapToolbar.css");
    const mobile = read("components/mobile/mobileMapShell.css");
    const cityStatus = read("components/map/cityStatusBanner.css");

    for (const selector of [".mapFitLondonBtn", ".mapRecenterBtn", ".mapCompassBtn", ".mapToolbarSearch input"] as const) {
      expectMinHeight(globals, selector);
    }
    expectMinHeight(toolbar, ".mapToolbarDesktopExtras .favoritePintSelect");
    expectMinHeight(mobile, ".appShell .mapStage .maplibregl-ctrl-attrib-button");
    expectMinHeight(cityStatus, ".cityStatusBannerLink");
  });

  it("keeps venue actions and Last Train controls at 44px", () => {
    const globals = read("app/globals.css");
    const venueActions = read("components/map/venueActionStrip.css");
    const priceStory = read("components/map/venuePriceStory.css");
    const lastTrain = read("components/map/LastTrainCard.tsx");

    expectMinHeight(venueActions, ".venueActionStrip__btn");
    for (const selector of [".addStopBtn", ".landlordBtn", ".landlordForm button"] as const) {
      expectMinHeight(globals, selector);
    }
    expectMinHeight(priceStory, ".vpsConfirmBtn");
    expect(lastTrain).toMatch(/destinationInput:[\s\S]*?minHeight:\s*44/);
    expect(lastTrain).toMatch(/destinationSubmit:[\s\S]*?minHeight:\s*44/);
  });
});
