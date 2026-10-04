import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import PublishedMenuPrices from "@/components/map/PublishedMenuPrices";
import type { ListedCategoryPrice } from "@/lib/listedCategoryPrices";

function renderQuote(observedAt: string) {
  const quote: ListedCategoryPrice = {
    source: "listed",
    category: "wine",
    drinkLabel: "Chardonnay",
    priceGbp: 5.5,
    servingSize: "125ml",
    sourceUrl: "https://pub.example/menu",
    observedAt,
  };
  return renderToStaticMarkup(createElement(PublishedMenuPrices, {
    prices: [quote], unavailable: false,
  }));
}

it("shows a late UTC summer observation on its London calendar day", () => {
  expect(renderQuote("2026-09-21T23:00:41Z")).toContain("Price seen 22 September 2026");
});

it.each(["not-a-date", ""])("keeps invalid observation %j from crashing a published quote", (observedAt) => {
  const html = renderQuote(observedAt);
  expect(html).toContain("Price date unavailable");
  expect(html).toContain("£5.50");
  expect(html).toContain('href="https://pub.example/menu"');
});

it.each([
  ["2026-01-21T23:00:41Z", "21 January 2026"],
  ["2026-01-22T00:00:41Z", "22 January 2026"],
  ["2026-09-21", "21 September 2026"],
])("shows observation %s as the absolute London day %s", (observedAt, day) => {
  expect(renderQuote(observedAt)).toContain(`Price seen ${day}`);
});
