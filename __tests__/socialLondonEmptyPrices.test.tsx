// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SocialLondonEmpty from "@/app/social/SocialLondonEmpty";
import { buildSocialAlternatives } from "@/lib/socialAlternatives";
import { parseUkPriceBundleRows } from "@/lib/ukPriceBundle";

const rows = parseUkPriceBundleRows(JSON.parse(readFileSync(
  join(process.cwd(), "public/data/uk_prices/rows.json"), "utf8",
)));
const venue = {
  id: "venue-uk-w745483505", name: "Lore of the Land", address: "4 Conway Street, W1T 6BB",
  latitude: 51.5220874, longitude: -0.1395832, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];

describe("Social empty-state menu labels from the published price bundle", () => {
  it.each([
    ["Pedro Ximenez 'Noe' 30-Year-Old VORS, Golzalez Byass, Jerez, Spain 37.5cl", 14.25],
    ["Sauternes 2022, Chateau Laville, Bordeaux, France 75cl", 11.75],
    ["'Kabir' Moscato di Panttelleria, Donnafugata, Sicily, Italy 75cl", 8.25],
  ] as const)("prints the complete source name for %s", (label, priceGbp) => {
    const row = rows.find((candidate) => candidate.venueId === venue.id && candidate.drinkLabel === label);
    expect(row).toBeDefined();
    const alternatives = buildSocialAlternatives(
      [venue], [], Date.parse("2026-11-07T12:00:00Z"), row ? [row] : [],
    );
    expect(alternatives.prices).toHaveLength(1);
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(SocialLondonEmpty, { alternatives }));
    const section = host.querySelector("section[aria-labelledby='social-empty-prices']");
    expect(section?.querySelector(".socialAlternativeMeta")?.textContent).toBe(`${label}, 50ml · £${priceGbp.toFixed(2)}`);
    expect(section?.querySelector(".socialAlternativeSource a")?.getAttribute("href"))
      .toBe("https://loreoftheland.com/menu/wine-list/");
    expect(section?.querySelector("time")?.dateTime).toBe("2026-10-19");
  });

  it("never offers a truncated dessert-wine name from the complete bundle", () => {
    const alternatives = buildSocialAlternatives([venue], [], Date.parse("2026-11-07T12:00:00Z"), rows);
    expect(alternatives.prices).toHaveLength(1);
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(createElement(SocialLondonEmpty, { alternatives }));
    const label = host.querySelector("section[aria-labelledby='social-empty-prices'] .socialAlternativeMeta")?.textContent;
    expect(label).toBeTruthy();
    expect(label).not.toMatch(/^(?:e' 30-Year|ine Sauternes|Moscato di Panttelleria)/);
  });
});
