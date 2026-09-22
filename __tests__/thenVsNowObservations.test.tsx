import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ThenVsNowCard from "@/components/discovery/ThenVsNowCard";
import { computeThenVsNow } from "@/lib/thenVsNow";

describe("Then-vs-Now observation card", () => {
  it("prints dated sources without movement language when terms are unknown", () => {
    const [item] = computeThenVsNow(
      [
        {
          id: "a",
          name: "A",
          cheapestPrice: 4,
          cheapestPint: "Lager",
          measure: "pint",
          observedAt: "2026-01-01T12:00:00.000Z",
          sourceId: "app_price_000001",
          sourceUrl: "https://www.pint-prices.com/pub/the-test-arms",
        },
      ],
      [
        {
          id: "drop-123",
          venueId: "a",
          priceGbp: 7,
          drink: "Stout",
          measure: "half",
          createdAt: "2026-09-21T18:00:00.000Z",
        },
      ],
    );

    const html = renderToStaticMarkup(createElement(ThenVsNowCard, { item }));
    expect(html).toContain("2026-01-01");
    expect(html).toContain("2026-09-21");
    expect(html).toContain("Lager");
    expect(html).toContain("Stout");
    expect(html).toContain("app_price_000001");
    expect(html).toContain('href="https://www.pint-prices.com/pub/the-test-arms"');
    expect(html).toContain('/p/drop-123');
    expect(html).toContain("No price-change comparison");
    expect(html).not.toContain("%");
    expect(html).not.toContain("tvnDelta-up");
    expect(html).not.toContain("tvnDelta-down");
  });

  it("keeps movement language for an exact, dated, regular-price pair", () => {
    const [item] = computeThenVsNow(
      [
        {
          id: "a",
          name: "A",
          cheapestPrice: 4,
          cheapestPint: "Lager",
          measure: "pint",
          observedAt: "2026-01-01T12:00:00.000Z",
          priceCondition: "regular",
          sourceId: "app_price_000001",
        },
      ],
      [
        {
          id: "drop-123",
          venueId: "a",
          priceGbp: 5,
          drink: "lager",
          measure: "pint",
          priceCondition: "regular",
          createdAt: "2026-09-21T18:00:00.000Z",
        },
      ],
    );

    const html = renderToStaticMarkup(createElement(ThenVsNowCard, { item }));
    expect(html).toContain("+£1.00 (25%)");
    expect(html).toContain("tvnDelta-up");
  });

  it("does not render an unsafe baseline source URL", () => {
    const [item] = computeThenVsNow(
      [
        {
          id: "a",
          name: "A",
          cheapestPrice: 4,
          cheapestPint: "Lager",
          measure: "pint",
          observedAt: "2026-01-01T12:00:00.000Z",
          sourceId: "app_price_000001",
          sourceUrl: "javascript:alert(1)",
        },
      ],
      [
        {
          id: "drop-123",
          venueId: "a",
          priceGbp: 7,
          drink: "Stout",
          measure: "half",
          createdAt: "2026-09-21T18:00:00.000Z",
        },
      ],
    );

    const html = renderToStaticMarkup(createElement(ThenVsNowCard, { item }));
    expect(html).toContain("source URL not recorded");
    expect(html).not.toContain("javascript:");
  });
});
