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
const NOW = Date.parse("2026-11-07T12:00:00Z");
const LORE = {
  id: "venue-uk-w745483505", name: "Lore of the Land", address: "4 Conway Street, W1T 6BB",
  latitude: 51.5220874, longitude: -0.1395832, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];
const THIRSTY_BEAR = {
  id: "venue-uk-n1707216586", name: "The Thirsty Bear", address: "62, Stamford street, London, SE1 9LX",
  latitude: 51.50707, longitude: -0.10812, kind: "pub", prices: [],
} satisfies Parameters<typeof buildSocialAlternatives>[0][number];

function pricesSection(venue: Parameters<typeof buildSocialAlternatives>[0][number]) {
  const alternatives = buildSocialAlternatives([venue], [], NOW, rows);
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(SocialLondonEmpty, { alternatives }));
  return { alternatives, section: host.querySelector("section[aria-labelledby='social-empty-prices']") };
}

describe("Social empty-state pint prices from the published price bundle", () => {
  it("keeps a pub's published wine list out and says no dated price is held", () => {
    expect(rows.some((row) => row.venueId === LORE.id && row.category === "wine")).toBe(true);
    const { alternatives, section } = pricesSection(LORE);
    expect(alternatives).toMatchObject({ priceRead: "ready", prices: [] });
    expect(section?.querySelector(".socialAlternativeMeta")?.textContent).toBe("No dated menu prices to show here yet.");
  });

  it("prints a published pint with its complete name, serving, publisher and read day", () => {
    const { alternatives, section } = pricesSection(THIRSTY_BEAR);
    expect(alternatives.prices).toHaveLength(1);
    expect(section?.querySelector(".socialAlternativeMeta")?.textContent).toBe("Inches Cider, pint · £5.95");
    expect(section?.querySelector(".socialAlternativeSource a")?.getAttribute("href"))
      .toBe("https://www.thethirstybear.com/drinks");
    expect(section?.querySelector("time")?.dateTime).toBe("2026-10-09");
  });
});
