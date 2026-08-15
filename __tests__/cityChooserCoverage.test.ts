import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "chooser-nonce" }),
}));

async function renderCityChooser(): Promise<string> {
  const { default: CityChooser } =
    await import("@/components/city/CityChooser");
  return renderToStaticMarkup(createElement(CityChooser));
}

describe("city chooser coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows London coverage without giving its Pint Price claim to other cities", async () => {
    const markup = await renderCityChooser();

    expect(markup).toContain("Dated Pint Prices");
    expect(markup.match(/class="cityChooserCoverageNeeded"/g)).toHaveLength(9);
    expect(markup).toContain(
      "London has dated Pint Prices. Other city guides say what is ready and what needs work.",
    );
  });

  it("publishes the enabled city maps as structured data", async () => {
    const { default: ChooseCityPage, metadata } =
      await import("@/app/choose-city/page");
    const page = await ChooseCityPage({});
    const markup = renderToStaticMarkup(page);

    expect(metadata.title).toBe("UK pub maps by city");
    expect(metadata.description).toContain("Browse 10 UK city pub maps");
    expect(markup).toContain('type="application/ld+json"');
    expect(markup).toContain('nonce="chooser-nonce"');
    expect(markup).toContain('"numberOfItems":10');
    expect(markup).toContain('"url":"https://pubmaxxing.com/map/llandudno"');
  });

  it("keeps needed coverage readable on the light section cards", () => {
    const css = readFileSync("components/city/cityChooser.css", "utf8");

    expect(css).toMatch(
      /\.cityChooser--section \.cityChooserCoverageNeeded\s*{\s*color:\s*var\(--ink\)/,
    );
  });

  it("shows editorial and map-only city gaps inside their existing links", async () => {
    const markup = await renderCityChooser();
    const manchester = markup.slice(
      markup.indexOf("Manchester"),
      markup.indexOf("Liverpool"),
    );
    const bath = markup.slice(
      markup.indexOf("Bath"),
      markup.indexOf("Llandudno"),
    );

    expect(manchester).toContain("Listed pubs");
    expect(manchester).toContain("Crawls");
    expect(manchester).toContain("Pint Prices needed");
    expect(bath).toContain("Listed pubs");
    expect(bath).toContain("Pint Prices and Crawls needed");
  });

  it("does not describe every city map as price-aware", async () => {
    const markup = await renderCityChooser();

    expect(markup).not.toContain("Open a price-aware pub map");
    expect(markup).not.toContain("nine city guides have prices and crawls");
  });
});
