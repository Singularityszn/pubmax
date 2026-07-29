import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapKey from "@/components/map/MapKey";
import { mapPriceLegend } from "@/lib/mapPriceLegend";

describe("MapKey", () => {
  const html = renderToStaticMarkup(
    createElement(MapKey, { legend: mapPriceLegend(false) }),
  );

  it("pairs every colour band with a symbol and visible price text", () => {
    expect(html).toContain("£5.50 or less");
    expect(html).toContain("Over £5.50, up to £7");
    expect(html).toContain("Over £7");
    expect(html).toContain("No pint price on the map");
    expect(html).toContain("mapKeyPriceCode");
    expect(html).toContain("Your approximate location");
  });

  it("keeps decorative colour and shape samples out of the accessibility tree", () => {
    expect(html).toContain('class="mapKeyPriceSwatch');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("One recent pint report");
    expect(html).toContain("This pub has a visible Pint Drop");
  });

  it("uses semantic sections and expandable detail groups", () => {
    expect(html).toContain("<h3");
    expect(html).toContain("<details");
    expect(html).toContain("<summary>Pin shapes</summary>");
    expect(html).toContain("<summary>Dots and rings</summary>");
    expect(html).toContain("<summary>Routes</summary>");
  });
});
